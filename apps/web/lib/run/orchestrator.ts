import { randomUUID } from "node:crypto";
import type { TransferExpectation, Verification } from "@travessia/hodle/chain";
import {
  DepositCreatedSchema,
  DepositStatusSchema,
  HodleError,
  PayoutResultSchema,
  type CallRecord,
  type CallResult,
  type Deposit,
  type HodleClient,
  type PixKeyType,
} from "@travessia/hodle/client";
import { brlCentsToTokenRaw, formatDecimal } from "@travessia/hodle/money";
import type { z } from "zod";
import type { Store } from "../store/store";
import { asToken, depositExpectation, payoutExpectation, swapExpectations, type LegExpectation } from "./expectations";
import type { RunLock } from "./lock";
import { DEMO, idempotencyKey, STEP_ORDER, type StepName } from "./steps";
import { buildRunView, type RunView } from "./view";

export type VerifyFn = (hash: `0x${string}`, expected: TransferExpectation, options?: { timeoutMs?: number }) => Promise<Verification>;

export interface OrchestratorDeps {
  client: HodleClient;
  store: Store;
  lock: RunLock;
  verify: VerifyFn;
  pixKey: string;
  dailyRunCap: number;
  killSwitch: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newRunId?: () => string;
  depositPollTimeoutMs?: number;
  depositPollIntervalMs?: number;
  maxAttempts?: number;
  maxReplays?: number;
  /** Teto global de repetições de saque por minuto (protege o limite de 60 req/min da chave). */
  maxReplaysPerMinute?: number;
}

export type StartResult =
  | { kind: "started"; runId: string }
  | { kind: "busy"; retryAfterSec: number }
  | { kind: "unavailable"; reason: "kill_switch" | "daily_cap"; lastCompletedRunId: string | null };

export type NextResult =
  | { kind: "progressed"; view: RunView; retryAfterSec: number | null }
  | { kind: "finished"; view: RunView }
  | { kind: "busy"; view: RunView }
  | { kind: "not_holder"; view: RunView }
  | { kind: "not_found" };

export type ReplayResult =
  | { kind: "replayed"; view: RunView; sameTransaction: boolean }
  | { kind: "refused"; reason: string }
  | { kind: "error"; code: string | null; message: string }
  | { kind: "not_found" };

export interface Orchestrator {
  start(): StartResult;
  next(runId: string): Promise<NextResult>;
  replayPayout(runId: string): Promise<ReplayResult>;
  getView(runId: string, options?: { recheck?: boolean }): Promise<RunView | undefined>;
}

type StepOutcome = { status: "ok" } | { status: "failed" } | { status: "retry"; retryAfterSec: number | null };

const TERMINAL_DEPOSIT = new Set(["COMPLETED", "FAILED", "REFUNDED", "EXPIRED"]);

export const isRunId = (value: string): boolean => /^[0-9a-f]{12}$/.test(value);

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { client, store, lock } = deps;
  const now = deps.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newRunId = deps.newRunId ?? (() => randomUUID().replaceAll("-", "").slice(0, 12));
  const maxAttempts = deps.maxAttempts ?? 4;
  const maxReplays = deps.maxReplays ?? 3;
  const maxReplaysPerMinute = deps.maxReplaysPerMinute ?? 10;
  let recentReplays: number[] = [];
  const pollTimeoutMs = deps.depositPollTimeoutMs ?? 10_000;
  const pollIntervalMs = deps.depositPollIntervalMs ?? 1_000;

  function view(runId: string): RunView {
    const run = store.getRun(runId);
    if (!run) throw new Error(`execução ${runId} não existe`);
    return buildRunView({ run, steps: store.getSteps(runId), verifications: store.getVerifications(runId), replays: store.getReplays(runId) });
  }

  function storedResponse<T>(runId: string, name: StepName, schema: z.ZodType<T>): T {
    const row = store.getStep(runId, name);
    if (!row?.responseJson) throw new Error(`passo ${name} sem resposta gravada`);
    return schema.parse(JSON.parse(row.responseJson));
  }

  function walletOf(runId: string): string {
    const wallet = store.getRun(runId)?.walletAddress;
    if (!wallet) throw new Error("execução sem carteira de teste");
    return wallet;
  }

  function finish(runId: string, status: "completed" | "failed"): void {
    store.setRunStatus(runId, status, iso());
    lock.release(runId);
  }

  /** Marca o passo como sent uma única vez por tentativa, logo antes do fetch. */
  function sentMarker(runId: string, name: StepName, key: string | null) {
    let marked = false;
    return (record: CallRecord): void => {
      if (marked) return;
      store.markStepSent(runId, name, key, JSON.stringify(record), iso());
      marked = true;
    };
  }

  function recordError(runId: string, name: StepName, error: HodleError): StepOutcome {
    const retryable =
      error.outcomeUnknown || error.status === null || error.status === 429 || error.status >= 500 || error.code === "SANDBOX_SWAP_IN_PROGRESS";
    store.markStepResult(
      runId,
      name,
      {
        status: retryable ? "unknown" : "failed",
        responseJson: error.details === null || error.details === undefined ? null : JSON.stringify(error.details),
        httpStatus: error.status,
        latencyMs: Math.round(error.latencyMs),
        errorCode: error.code ?? (error.status ? `HTTP_${error.status}` : null),
        errorMessage: error.message,
      },
      iso(),
    );
    if (!retryable) return { status: "failed" };
    // Sem Retry-After, espera um pouco antes de repetir com a mesma chave: repetir na hora só queima tentativas.
    const defaultWait = error.status === 429 ? 5 : error.code === "SANDBOX_SWAP_IN_PROGRESS" ? 3 : 2;
    return { status: "retry", retryAfterSec: error.retryAfter ?? defaultWait };
  }

  async function callStep<T>(
    runId: string,
    name: StepName,
    key: string | null,
    call: (onSend: (record: CallRecord) => void) => Promise<CallResult<T>>,
    check: (data: T) => string | null,
  ): Promise<{ outcome: StepOutcome; result: CallResult<T> | null }> {
    const onSend = sentMarker(runId, name, key);
    let result: CallResult<T>;
    try {
      result = await call(onSend);
    } catch (error) {
      if (!(error instanceof HodleError)) throw error;
      onSend(error.request);
      return { outcome: recordError(runId, name, error), result: null };
    }
    let failure: string | null;
    try {
      failure = check(result.data);
    } catch {
      failure = "UNEXPECTED_RESPONSE";
    }
    store.markStepResult(
      runId,
      name,
      {
        status: failure ? "failed" : "ok",
        responseJson: JSON.stringify(result.body),
        httpStatus: result.httpStatus,
        latencyMs: Math.round(result.latencyMs),
        errorCode: failure,
        errorMessage: null,
      },
      iso(),
    );
    return { outcome: failure ? { status: "failed" } : { status: "ok" }, result };
  }

  async function verifyLegs(runId: string, legs: LegExpectation[]): Promise<void> {
    await Promise.all(
      legs.map(async (leg) => {
        const v = await deps.verify(leg.txHash, { token: leg.token, from: leg.from, to: leg.to, raw: leg.raw });
        store.saveVerification({
          runId,
          leg: leg.leg,
          step: leg.step,
          txHash: leg.txHash,
          token: leg.token,
          fromAddress: leg.from ?? null,
          toAddress: leg.to ?? null,
          rawExpected: leg.raw.toString(),
          rawObserved: v.observed?.raw.toString() ?? null,
          observedFrom: v.observed?.from ?? null,
          observedTo: v.observed?.to ?? null,
          result: v.result,
          reason: v.reason,
          checkedAt: iso(),
        });
      }),
    );
  }

  async function confirmDeposit(runId: string): Promise<StepOutcome> {
    const created = storedResponse(runId, "deposit", DepositCreatedSchema);
    const started = now();
    const deadline = started + pollTimeoutMs;
    const onSend = sentMarker(runId, "deposit_confirm", null);
    for (;;) {
      let res: CallResult<Deposit>;
      try {
        res = await client.getDeposit(created.trackId, { onSend });
      } catch (error) {
        if (!(error instanceof HodleError)) throw error;
        onSend(error.request);
        return recordError(runId, "deposit_confirm", error);
      }
      const status = res.data.status;
      const terminal = TERMINAL_DEPOSIT.has(status);
      if (!terminal && now() + pollIntervalMs <= deadline) {
        await sleep(pollIntervalMs);
        continue;
      }
      const failure = !terminal ? null : status !== "COMPLETED" ? `DEPOSIT_${status}` : res.data.transactionHash ? null : "MISSING_TX_HASH";
      store.markStepResult(
        runId,
        "deposit_confirm",
        {
          status: !terminal ? "unknown" : failure ? "failed" : "ok",
          responseJson: JSON.stringify(res.body),
          httpStatus: res.httpStatus,
          latencyMs: Math.round(now() - started),
          errorCode: !terminal ? "DEPOSIT_NOT_CONFIRMED" : failure,
          errorMessage: !terminal ? `o depósito continua ${status} após ${pollTimeoutMs / 1000} s` : null,
        },
        iso(),
      );
      if (!terminal) return { status: "retry", retryAfterSec: null };
      if (failure) return { status: "failed" };
      await verifyLegs(runId, [depositExpectation(res.data, walletOf(runId))]);
      return { status: "ok" };
    }
  }

  async function runStep(runId: string, name: StepName): Promise<StepOutcome> {
    switch (name) {
      case "deposit": {
        const key = idempotencyKey(runId, "deposit");
        const { outcome, result } = await callStep(
          runId,
          name,
          key,
          (onSend) => client.createDeposit({ valueCents: DEMO.depositCents, asset: "BRLH", externalId: key }, { onSend }),
          () => null,
        );
        if (result) store.setRunWallet(runId, result.data.address);
        return outcome;
      }
      case "settle": {
        const deposit = storedResponse(runId, "deposit", DepositCreatedSchema);
        const { outcome } = await callStep(
          runId,
          name,
          null,
          (onSend) => client.settleSandboxDeposit(deposit.trackId, { onSend }),
          (data) => (data.settled ? null : "NOT_SETTLED"),
        );
        return outcome;
      }
      case "deposit_confirm":
        return confirmDeposit(runId);
      case "swap": {
        const deposit = storedResponse(runId, "deposit_confirm", DepositStatusSchema);
        const token = asToken(deposit.asset);
        const amount = formatDecimal(brlCentsToTokenRaw(BigInt(deposit.value) - BigInt(deposit.fee), token), 18);
        const key = idempotencyKey(runId, "swap");
        const { outcome, result } = await callStep(
          runId,
          name,
          key,
          (onSend) => client.swap({ fromAsset: token, toAsset: "USDH", amount, clientRequestId: key }, { onSend }),
          (data) =>
            data.status !== "COMPLETED"
              ? `SWAP_${data.status}`
              : !data.sandbox?.debitTxHash || !data.sandbox.creditTxHash
                ? "MISSING_TX_HASH"
                : null,
        );
        if (outcome.status === "ok" && result?.data.sandbox) await verifyLegs(runId, swapExpectations(result.data.sandbox, walletOf(runId)));
        return outcome;
      }
      case "payout": {
        const key = idempotencyKey(runId, "payout");
        const { outcome, result } = await callStep(
          runId,
          name,
          key,
          (onSend) =>
            client.createPayout(
              { valueCents: DEMO.payoutCents, asset: "USDH", network: "base", pixKey: deps.pixKey, pixKeyType: "EMAIL", externalId: key },
              { onSend },
            ),
          (data) => (data.status !== "COMPLETED" ? `PAYOUT_${data.status}` : !data.txHash || !data.stableAmount ? "MISSING_TX_HASH" : null),
        );
        if (outcome.status === "ok" && result) await verifyLegs(runId, [payoutExpectation(result.data, walletOf(runId))]);
        return outcome;
      }
    }
  }

  function start(): StartResult {
    if (deps.killSwitch) return { kind: "unavailable", reason: "kill_switch", lastCompletedRunId: store.lastCompletedRun()?.id ?? null };
    const dayStart = `${new Date(now()).toISOString().slice(0, 10)}T00:00:00.000Z`;
    if (store.countRunsSince(dayStart) >= deps.dailyRunCap) {
      return { kind: "unavailable", reason: "daily_cap", lastCompletedRunId: store.lastCompletedRun()?.id ?? null };
    }
    const runId = newRunId();
    const acquired = lock.acquire(runId, now());
    if (!acquired.ok) return { kind: "busy", retryAfterSec: acquired.retryAfterSec };
    store.createRun(runId, iso());
    return { kind: "started", runId };
  }

  async function next(runId: string): Promise<NextResult> {
    if (!isRunId(runId)) return { kind: "not_found" };
    const run = store.getRun(runId);
    if (!run) return { kind: "not_found" };
    if (run.status !== "running") return { kind: "finished", view: view(runId) };
    if (!lock.holds(runId, now())) {
      store.setRunStatus(runId, "interrupted", iso());
      return { kind: "not_holder", view: view(runId) };
    }
    if (!lock.tryBeginStep(runId)) return { kind: "busy", view: view(runId) };
    try {
      const steps = store.getSteps(runId);
      const name = STEP_ORDER.find((n) => steps.find((s) => s.name === n)?.status !== "ok");
      if (!name) {
        finish(runId, "completed");
        return { kind: "finished", view: view(runId) };
      }
      const existing = steps.find((s) => s.name === name);
      if (existing?.status === "failed") {
        finish(runId, "failed");
        return { kind: "finished", view: view(runId) };
      }
      if (existing && existing.attempts >= maxAttempts) {
        store.markStepResult(
          runId,
          name,
          {
            status: "failed",
            responseJson: existing.responseJson,
            httpStatus: existing.httpStatus,
            latencyMs: existing.latencyMs,
            errorCode: "MAX_ATTEMPTS",
            errorMessage: `sem resultado conclusivo após ${maxAttempts} tentativas`,
          },
          iso(),
        );
        finish(runId, "failed");
        return { kind: "finished", view: view(runId) };
      }
      const outcome = await runStep(runId, name);
      if (outcome.status === "failed") {
        finish(runId, "failed");
        return { kind: "finished", view: view(runId) };
      }
      if (outcome.status === "ok" && name === "payout") {
        finish(runId, "completed");
        return { kind: "finished", view: view(runId) };
      }
      return { kind: "progressed", view: view(runId), retryAfterSec: outcome.status === "retry" ? outcome.retryAfterSec : null };
    } finally {
      lock.endStep(runId, now());
    }
  }

  async function replayPayout(runId: string): Promise<ReplayResult> {
    if (!isRunId(runId) || !store.getRun(runId)) return { kind: "not_found" };
    if (deps.killSwitch) return { kind: "refused", reason: "As execuções estão pausadas no momento." };
    const payout = store.getStep(runId, "payout");
    if (payout?.status !== "ok" || !payout.requestJson || !payout.responseJson) {
      return { kind: "refused", reason: "O saque desta execução não foi concluído: não há pagamento para repetir." };
    }
    if (store.getReplays(runId).length >= maxReplays) {
      return { kind: "refused", reason: `Limite de ${maxReplays} repetições por execução atingido.` };
    }
    const original = PayoutResultSchema.parse(JSON.parse(payout.responseJson));
    const body = (JSON.parse(payout.requestJson) as CallRecord).body as {
      value: number;
      asset: string;
      network: string;
      pixKey: string;
      pixKeyType: PixKeyType;
      externalId: string;
    };
    const t = now();
    recentReplays = recentReplays.filter((at) => t - at < 60_000);
    if (recentReplays.length >= maxReplaysPerMinute) {
      return { kind: "refused", reason: "Muitas repetições no último minuto: tente de novo em instantes." };
    }
    // A repetição usa a carteira compartilhada: entra na mesma trava das execuções. Tudo até aqui é síncrono,
    // então checar o limite e pegar a trava acontecem sem corrida.
    const holder = `replay-${runId}`;
    if (!lock.acquire(holder, t).ok) {
      return { kind: "refused", reason: "Outra operação está usando a carteira de teste agora: tente de novo em alguns segundos." };
    }
    lock.tryBeginStep(holder);
    recentReplays.push(t);
    try {
      const result = await client.createPayout({
        valueCents: BigInt(body.value),
        asset: body.asset,
        network: body.network,
        pixKey: body.pixKey,
        pixKeyType: body.pixKeyType,
        externalId: body.externalId,
      });
      const same = result.data.transactionId === original.transactionId && (result.data.txHash ?? null) === (original.txHash ?? null);
      store.addReplay(runId, JSON.stringify(result.body), same, iso());
      return { kind: "replayed", view: view(runId), sameTransaction: same };
    } catch (error) {
      if (!(error instanceof HodleError)) throw error;
      return { kind: "error", code: error.code, message: error.message };
    } finally {
      lock.endStep(holder, now());
      lock.release(holder);
    }
  }

  async function getView(runId: string, options: { recheck?: boolean } = {}): Promise<RunView | undefined> {
    if (!isRunId(runId)) return undefined;
    const run = store.getRun(runId);
    if (!run) return undefined;
    if (run.status === "running" && lock.current(now()) !== runId) store.setRunStatus(runId, "interrupted", iso());
    if (options.recheck) {
      const pending = store.getVerifications(runId).filter((row) => row.result === "nao_conferido");
      await Promise.all(
        pending.map(async (row) => {
          const v = await deps.verify(
            row.txHash as `0x${string}`,
            { token: asToken(row.token), from: row.fromAddress ?? undefined, to: row.toAddress ?? undefined, raw: BigInt(row.rawExpected) },
            { timeoutMs: 3_000 },
          );
          store.saveVerification({
            ...row,
            rawObserved: v.observed?.raw.toString() ?? null,
            observedFrom: v.observed?.from ?? null,
            observedTo: v.observed?.to ?? null,
            result: v.result,
            reason: v.reason,
            checkedAt: iso(),
          });
        }),
      );
    }
    return view(runId);
  }

  return { start, next, replayPayout, getView };
}
