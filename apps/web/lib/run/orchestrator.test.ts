import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TransferExpectation, VerificationResult } from "@travessia/hodle/chain";
import { createHodleClient } from "@travessia/hodle/client";
import { describe, expect, it } from "vitest";
import { createSandboxDouble, HASH, SETTLEMENT, WALLET, type DoubleOptions } from "../../test/sandbox-double";
import { openStore, type Store } from "../store/store";
import { createRunLock } from "./lock";
import { createOrchestrator, type NextResult, type Orchestrator, type OrchestratorDeps, type StartResult, type VerifyFn } from "./orchestrator";

const API_KEY = "hodle_test_UNITTESTKEY1234567890";
const ZERO = "0x0000000000000000000000000000000000000000";
const T0 = Date.parse("2026-10-16T12:00:00.000Z");

function setup(options: DoubleOptions = {}, overrides: Partial<OrchestratorDeps> = {}, dbPath = ":memory:") {
  const double = createSandboxDouble(options);
  const client = createHodleClient({ apiKey: API_KEY, baseUrl: "https://sandbox.test", fetch: double.fetch, readTimeoutMs: 50, writeTimeoutMs: 50 });
  const store = openStore(dbPath);
  let clock = T0;
  const lock = createRunLock({ onExpire: (id) => store.setRunStatus(id, "interrupted", new Date(clock).toISOString()) });
  const verifier = { result: "confere" as VerificationResult };
  const verifyCalls: { hash: string; expected: TransferExpectation }[] = [];
  const verify: VerifyFn = async (hash, expected) => {
    verifyCalls.push({ hash, expected });
    if (verifier.result === "nao_conferido") return { result: "nao_conferido", observed: null, reason: "RPC indisponível: teste" };
    return { result: "confere", observed: { from: expected.from ?? WALLET, to: expected.to ?? SETTLEMENT, raw: expected.raw }, reason: null };
  };
  let ids = 0;
  const orchestrator = createOrchestrator({
    client,
    store,
    lock,
    verify,
    pixKey: "recebedor@example.com",
    dailyRunCap: 200,
    killSwitch: false,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    newRunId: () => (++ids).toString(16).padStart(12, "0"),
    ...overrides,
  });
  return { orchestrator, store, double, verifier, verifyCalls, advance: (ms: number) => void (clock += ms) };
}

function started(result: StartResult): string {
  if (result.kind !== "started") throw new Error(`esperava started, veio ${result.kind}`);
  return result.runId;
}

async function runToEnd(orchestrator: Orchestrator, runId: string): Promise<NextResult> {
  for (let i = 0; i < 20; i++) {
    const result = await orchestrator.next(runId);
    if (result.kind !== "progressed") return result;
  }
  throw new Error("a execução não terminou em 20 chamadas");
}

const posts = <T extends { method: string; path: string }>(calls: T[], path: string) => calls.filter((c) => c.method === "POST" && c.path === path);

describe("orquestrador", () => {
  it("ciclo feliz: cinco passos, chaves derivadas do runId, quatro conferências exatas e fechamento", async () => {
    const { orchestrator, store, verifyCalls } = setup();
    const runId = started(orchestrator.start());
    const result = await runToEnd(orchestrator, runId);

    expect(result.kind).toBe("finished");
    expect(store.getRun(runId)).toMatchObject({ status: "completed", walletAddress: WALLET });
    expect(store.getSteps(runId).map((s) => [s.name, s.status, s.idempotencyKey])).toEqual([
      ["deposit", "ok", `trv-${runId}-dep`],
      ["settle", "ok", null],
      ["deposit_confirm", "ok", null],
      ["swap", "ok", `trv-${runId}-swap`],
      ["payout", "ok", `trv-${runId}-pay`],
    ]);
    expect(verifyCalls).toEqual([
      { hash: HASH.mint, expected: { token: "BRLH", from: ZERO, to: WALLET, raw: 54n * 10n ** 18n } },
      { hash: HASH.debit, expected: { token: "BRLH", from: WALLET, to: undefined, raw: 54n * 10n ** 18n } },
      { hash: HASH.credit, expected: { token: "USDH", from: ZERO, to: WALLET, raw: 10_000_000n } },
      { hash: HASH.payout, expected: { token: "USDH", from: WALLET, to: undefined, raw: 5_000_000n } },
    ]);
    if (result.kind !== "finished") throw new Error();
    expect(result.view.verifications.map((v) => v.result)).toEqual(["confere", "confere", "confere", "confere"]);
    expect(result.view.closing?.display).toEqual({ in: "R$ 54,00", pixOut: "R$ 27,00", kept: "R$ 27,00", fees: "R$ 0,00" });
    expect(orchestrator.start().kind).toBe("started");
  });

  it("grava cada passo como sent antes da chamada de escrita", async () => {
    const seen: string[] = [];
    const stepOf: Record<string, "deposit" | "settle" | "swap" | "payout"> = {
      "/api/deposit/asset": "deposit",
      "/avenia/webhook": "settle",
      "/api/wallet/swap": "swap",
      "/api/wallet/payout": "payout",
    };
    const probe: { store?: Store; runId: string } = { runId: "" };
    const ctx = setup({
      onRequest: (method, path) => {
        const name = stepOf[path];
        if (method !== "POST" || !name) return;
        seen.push(`${name}:${probe.store?.getStep(probe.runId, name)?.status}`);
      },
    });
    probe.store = ctx.store;
    probe.runId = started(ctx.orchestrator.start());
    await runToEnd(ctx.orchestrator, probe.runId);
    expect(seen).toEqual(["deposit:sent", "settle:sent", "swap:sent", "payout:sent"]);
  });

  it("timeout no saque: passo incerto, repetição com a mesma chave, um único pagamento", async () => {
    const { orchestrator, store, double } = setup({ hangPayoutOnce: true });
    const runId = started(orchestrator.start());
    let result: NextResult = { kind: "not_found" };
    for (let i = 0; i < 5; i++) result = await orchestrator.next(runId);
    expect(result.kind).toBe("progressed");
    expect(store.getStep(runId, "payout")).toMatchObject({ status: "unknown", errorCode: "TIMEOUT" });

    expect((await orchestrator.next(runId)).kind).toBe("finished");
    const payoutPosts = posts(double.calls, "/api/wallet/payout");
    expect(payoutPosts).toHaveLength(2);
    expect(payoutPosts.map((c) => (c as { body: { externalId: string } }).body.externalId)).toEqual([`trv-${runId}-pay`, `trv-${runId}-pay`]);
    expect(double.payouts.size).toBe(1);
    expect(store.getStep(runId, "payout")).toMatchObject({ status: "ok", attempts: 2 });
    expect(store.getRun(runId)?.status).toBe("completed");
  });

  it("saldo insuficiente: passo failed com o código exato, execução failed, trava liberada", async () => {
    const { orchestrator, store } = setup({
      payoutError: { status: 400, body: { success: false, error: "Saldo insuficiente de USDH na carteira de teste", errorCode: "SANDBOX_INSUFFICIENT_BALANCE" } },
    });
    const runId = started(orchestrator.start());
    const result = await runToEnd(orchestrator, runId);
    expect(result.kind).toBe("finished");
    expect(store.getStep(runId, "payout")).toMatchObject({ status: "failed", httpStatus: 400, errorCode: "SANDBOX_INSUFFICIENT_BALANCE" });
    expect(store.getRun(runId)?.status).toBe("failed");
    expect(orchestrator.start().kind).toBe("started");
  });

  it("payout 202 com status FAILED: failed e nenhuma conferência inventada", async () => {
    const { orchestrator, store } = setup({ payoutStatus: "FAILED" });
    const runId = started(orchestrator.start());
    await runToEnd(orchestrator, runId);
    expect(store.getStep(runId, "payout")).toMatchObject({ status: "failed", httpStatus: 202, errorCode: "PAYOUT_FAILED" });
    expect(store.getVerifications(runId).map((v) => v.leg)).not.toContain("payout_debit");
  });

  it("swap 422 SANDBOX_SWAP_REFUNDED: failed com os hashes visíveis", async () => {
    const { orchestrator } = setup({
      swapError: {
        status: 422,
        body: { success: false, error: "refunded", errorCode: "SANDBOX_SWAP_REFUNDED", sandbox: { debitTxHash: HASH.debit, refundTxHash: HASH.refund } },
      },
    });
    const runId = started(orchestrator.start());
    const result = await runToEnd(orchestrator, runId);
    if (result.kind !== "finished") throw new Error(result.kind);
    const swap = result.view.steps.find((s) => s.name === "swap")!;
    expect(swap).toMatchObject({ status: "failed", errorCode: "SANDBOX_SWAP_REFUNDED" });
    expect(swap.hashes.map((h) => h.hash)).toEqual([HASH.debit, HASH.refund]);
    expect(result.view.status).toBe("failed");
  });

  it("depósito que não confirma: unknown limitado a 10 s por tentativa, depois MAX_ATTEMPTS", async () => {
    const { orchestrator, store, double } = setup({ depositStaysPending: true });
    const runId = started(orchestrator.start());
    await orchestrator.next(runId);
    await orchestrator.next(runId);
    const third = await orchestrator.next(runId);
    expect(third.kind).toBe("progressed");
    expect(store.getStep(runId, "deposit_confirm")).toMatchObject({ status: "unknown", errorCode: "DEPOSIT_NOT_CONFIRMED" });

    const result = await runToEnd(orchestrator, runId);
    expect(result.kind).toBe("finished");
    expect(store.getStep(runId, "deposit_confirm")).toMatchObject({ status: "failed", errorCode: "MAX_ATTEMPTS", attempts: 4 });
    expect(double.calls.filter((c) => c.method === "GET").length).toBeLessThanOrEqual(4 * 11);
    expect(store.getRun(runId)?.status).toBe("failed");
  });

  it("429 no swap: devolve Retry-After e repete com o mesmo clientRequestId", async () => {
    const { orchestrator, double } = setup({ rateLimitSwapOnce: 2 });
    const runId = started(orchestrator.start());
    const results: NextResult[] = [];
    for (let i = 0; i < 4; i++) results.push(await orchestrator.next(runId));
    expect(results[3]).toMatchObject({ kind: "progressed", retryAfterSec: 2 });
    await runToEnd(orchestrator, runId);
    const swapPosts = posts(double.calls, "/api/wallet/swap") as { body: { clientRequestId: string } }[];
    expect(swapPosts.map((c) => c.body.clientRequestId)).toEqual([`trv-${runId}-swap`, `trv-${runId}-swap`]);
  });

  it("dois cliques ao mesmo tempo: uma execução começa, a outra recebe busy", () => {
    const { orchestrator } = setup();
    expect(orchestrator.start().kind).toBe("started");
    expect(orchestrator.start()).toEqual({ kind: "busy", retryAfterSec: 15 });
  });

  it("kill switch e teto diário (dia UTC)", async () => {
    expect(setup({}, { killSwitch: true }).orchestrator.start()).toEqual({ kind: "unavailable", reason: "kill_switch", lastCompletedRunId: null });
    const { orchestrator } = setup({}, { dailyRunCap: 1 });
    const runId = started(orchestrator.start());
    await runToEnd(orchestrator, runId);
    expect(orchestrator.start()).toEqual({ kind: "unavailable", reason: "daily_cap", lastCompletedRunId: runId });
  });

  it("next depois de terminar devolve o estado final sem chamar a API", async () => {
    const { orchestrator, double } = setup();
    const runId = started(orchestrator.start());
    await runToEnd(orchestrator, runId);
    const before = double.calls.length;
    const again = await orchestrator.next(runId);
    expect(again.kind).toBe("finished");
    expect(double.calls.length).toBe(before);
  });

  it("navegador sumiu: lease vence, execução interrompida, trava livre", async () => {
    const { orchestrator, store, advance } = setup();
    const runId = started(orchestrator.start());
    await orchestrator.next(runId);
    advance(45_001);
    expect((await orchestrator.next(runId)).kind).toBe("not_holder");
    expect(store.getRun(runId)?.status).toBe("interrupted");
    expect(orchestrator.start().kind).toBe("started");
  });

  it("dois next simultâneos na mesma execução: o segundo recebe busy", async () => {
    const { orchestrator } = setup();
    const runId = started(orchestrator.start());
    const [a, b] = await Promise.all([orchestrator.next(runId), orchestrator.next(runId)]);
    expect([a.kind, b.kind].sort()).toEqual(["busy", "progressed"]);
  });

  it("pagar de novo: mesma transação, nenhum pagamento novo; no máximo 3 vezes", async () => {
    const { orchestrator, double } = setup();
    const runId = started(orchestrator.start());
    await runToEnd(orchestrator, runId);
    const replay = await orchestrator.replayPayout(runId);
    expect(replay).toMatchObject({ kind: "replayed", sameTransaction: true });
    if (replay.kind !== "replayed") throw new Error();
    expect(replay.view.replays[0]?.second?.transactionId).toBe(replay.view.payout?.transactionId);
    expect(double.payouts.size).toBe(1);
    await orchestrator.replayPayout(runId);
    await orchestrator.replayPayout(runId);
    expect(await orchestrator.replayPayout(runId)).toEqual({ kind: "refused", reason: "Limite de 3 repetições por execução atingido." });
  });

  it("pagar de novo recusa quando o saque não foi concluído", async () => {
    const { orchestrator, double } = setup({
      payoutError: { status: 400, body: { success: false, error: "Saldo insuficiente", errorCode: "SANDBOX_INSUFFICIENT_BALANCE" } },
    });
    const runId = started(orchestrator.start());
    await runToEnd(orchestrator, runId);
    const before = double.calls.length;
    expect(await orchestrator.replayPayout(runId)).toEqual({
      kind: "refused",
      reason: "O saque desta execução não foi concluído: não há pagamento para repetir.",
    });
    expect(double.calls.length).toBe(before);
    expect(await orchestrator.replayPayout("naoexiste")).toEqual({ kind: "not_found" });
  });

  it("a chave da API não aparece no banco nem na visão, nem quando a API a ecoa", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "orq-")), "t.sqlite");
    const { orchestrator, store } = setup(
      { payoutError: { status: 401, body: { success: false, error: `chave ${API_KEY} recusada`, errorCode: "UNAUTHORIZED" } } },
      {},
      dbPath,
    );
    const runId = started(orchestrator.start());
    const result = await runToEnd(orchestrator, runId);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(store.getStep(runId, "payout")?.errorMessage).toBe("chave [REDACTED] recusada");
    store.close();
    for (const file of [dbPath, `${dbPath}-wal`]) {
      if (existsSync(file)) expect(readFileSync(file, "latin1")).not.toContain(API_KEY);
    }
  });

  it("getView marca como interrompida a execução running sem trava (servidor reiniciado)", async () => {
    const first = setup();
    const runId = started(first.orchestrator.start());
    const lonely = createOrchestrator({
      client: createHodleClient({ apiKey: API_KEY, baseUrl: "https://sandbox.test", fetch: first.double.fetch }),
      store: first.store,
      lock: createRunLock({ onExpire: () => {} }),
      verify: async () => ({ result: "confere", observed: null, reason: null }),
      pixKey: "recebedor@example.com",
      dailyRunCap: 200,
      killSwitch: false,
    });
    expect((await lonely.getView(runId))?.status).toBe("interrupted");
    expect(await lonely.getView("zzzz")).toBeUndefined();
  });

  it("recheck: o que ficou 'ainda não conferido' é conferido de novo quando o RPC volta", async () => {
    const { orchestrator, verifier } = setup();
    verifier.result = "nao_conferido";
    const runId = started(orchestrator.start());
    const result = await runToEnd(orchestrator, runId);
    if (result.kind !== "finished") throw new Error();
    expect(result.view.verifications.every((v) => v.result === "nao_conferido")).toBe(true);
    expect(result.view.status).toBe("completed");
    verifier.result = "confere";
    const view = await orchestrator.getView(runId, { recheck: true });
    expect(view?.verifications.map((v) => v.result)).toEqual(["confere", "confere", "confere", "confere"]);
  });
});
