import { explorerAddressUrl, explorerTxUrl } from "@travessia/hodle/chain";
import { DepositStatusSchema, PayoutResultSchema, SwapResultSchema, type CallRecord } from "@travessia/hodle/client";
import { formatBrl, formatToken, type Token } from "@travessia/hodle/money";
import type { ReplayRow, RunRow, RunStatus, StepRow, StepStatus, VerificationResultValue, VerificationRow } from "../store/store";
import { computeClosing } from "./closing";
import { LEG_LABEL, LEG_ORDER, STEP_ACT, STEP_ORDER, type Act, type Leg, type StepName } from "./steps";

export interface HashRef {
  hash: string;
  url: string;
}

export interface StepView {
  name: StepName;
  act: Act;
  status: StepStatus | "pending";
  attempts: number;
  idempotencyKey: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Status exatamente como a API devolveu (COMPLETED, PENDING…), quando houver. */
  apiStatus: string | null;
  request: CallRecord | null;
  response: unknown;
  hashes: HashRef[];
}

export interface VerificationView {
  leg: Leg;
  label: string;
  step: StepName;
  txHash: string;
  explorerUrl: string;
  token: Token;
  apiSays: { raw: string; display: string; expected: boolean };
  chainSays: { raw: string; display: string } | null;
  result: VerificationResultValue;
  reason: string | null;
}

export interface ClosingView {
  balanced: boolean;
  cents: { in: string; pixOut: string; kept: string; fees: string };
  display: { in: string; pixOut: string; kept: string; fees: string };
}

export interface PayoutSummary {
  transactionId: string;
  txHash: string | null;
  endToEndId: string | null;
  status: string;
}

export interface ReplayView {
  at: string;
  sameTransaction: boolean;
  second: PayoutSummary | null;
}

export interface RunView {
  id: string;
  status: RunStatus;
  walletAddress: string | null;
  walletExplorerUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  steps: StepView[];
  verifications: VerificationView[];
  closing: ClosingView | null;
  payout: PayoutSummary | null;
  replays: ReplayView[];
  permalinkPath: string;
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const parseJson = (text: string | null): unknown => (text ? (JSON.parse(text) as unknown) : null);

function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractHashes(value: unknown): HashRef[] {
  const found: string[] = [];
  const walk = (current: unknown): void => {
    if (typeof current === "string") {
      if (HASH_RE.test(current) && !found.includes(current)) found.push(current);
    } else if (Array.isArray(current)) {
      current.forEach(walk);
    } else if (current !== null && typeof current === "object") {
      Object.values(current).forEach(walk);
    }
  };
  walk(value);
  return found.map((hash) => ({ hash, url: explorerTxUrl(hash) }));
}

function apiStatusOf(name: StepName, response: unknown): string | null {
  const status = name === "deposit_confirm" ? field(response, "data", "status") : name === "swap" || name === "payout" ? field(response, "status") : undefined;
  return typeof status === "string" ? status : null;
}

function toStepView(name: StepName, row: StepRow | undefined): StepView {
  const response = parseJson(row?.responseJson ?? null);
  return {
    name,
    act: STEP_ACT[name],
    status: row?.status ?? "pending",
    attempts: row?.attempts ?? 0,
    idempotencyKey: row?.idempotencyKey ?? null,
    httpStatus: row?.httpStatus ?? null,
    latencyMs: row?.latencyMs ?? null,
    errorCode: row?.errorCode ?? null,
    errorMessage: row?.errorMessage ?? null,
    apiStatus: apiStatusOf(name, response),
    request: parseJson(row?.requestJson ?? null) as CallRecord | null,
    response,
    hashes: extractHashes(response),
  };
}

function toVerificationView(row: VerificationRow): VerificationView {
  const token = row.token as Token;
  return {
    leg: row.leg,
    label: LEG_LABEL[row.leg],
    step: row.step,
    txHash: row.txHash,
    explorerUrl: explorerTxUrl(row.txHash),
    token,
    apiSays: { raw: row.rawExpected, display: formatToken(BigInt(row.rawExpected), token), expected: row.leg === "deposit_mint" },
    chainSays: row.rawObserved === null ? null : { raw: row.rawObserved, display: formatToken(BigInt(row.rawObserved), token) },
    result: row.result,
    reason: row.reason,
  };
}

function payoutSummaryOf(body: unknown): PayoutSummary | null {
  const parsed = PayoutResultSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data;
  return { transactionId: p.transactionId, txHash: p.txHash ?? null, endToEndId: p.endToEndId ?? null, status: p.status };
}

function closingOf(byName: Map<StepName, StepRow>): ClosingView | null {
  const deposit = DepositStatusSchema.safeParse(parseJson(byName.get("deposit_confirm")?.responseJson ?? null));
  const swap = SwapResultSchema.safeParse(parseJson(byName.get("swap")?.responseJson ?? null));
  const payout = PayoutResultSchema.safeParse(parseJson(byName.get("payout")?.responseJson ?? null));
  if (!deposit.success || !swap.success || !swap.data.sandbox || !payout.success) return null;
  try {
    const c = computeClosing({ deposit: deposit.data, swap: swap.data.sandbox, payout: payout.data });
    return {
      balanced: c.balanced,
      cents: { in: c.inCents.toString(), pixOut: c.pixOutCents.toString(), kept: c.keptCents.toString(), fees: c.feesCents.toString() },
      display: { in: formatBrl(c.inCents), pixOut: formatBrl(c.pixOutCents), kept: formatBrl(c.keptCents), fees: formatBrl(c.feesCents) },
    };
  } catch {
    return null;
  }
}

export function buildRunView(input: { run: RunRow; steps: StepRow[]; verifications: VerificationRow[]; replays: ReplayRow[] }): RunView {
  const { run } = input;
  const byName = new Map(input.steps.map((row) => [row.name, row]));
  const payoutRow = byName.get("payout");
  return {
    id: run.id,
    status: run.status,
    walletAddress: run.walletAddress,
    walletExplorerUrl: run.walletAddress ? explorerAddressUrl(run.walletAddress) : null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null,
    steps: STEP_ORDER.map((name) => toStepView(name, byName.get(name))),
    verifications: LEG_ORDER.flatMap((leg) => {
      const row = input.verifications.find((v) => v.leg === leg);
      return row ? [toVerificationView(row)] : [];
    }),
    closing: run.status === "completed" ? closingOf(byName) : null,
    payout: payoutRow?.status === "ok" ? payoutSummaryOf(parseJson(payoutRow.responseJson)) : null,
    replays: input.replays.map((replay) => ({
      at: replay.createdAt,
      sameTransaction: replay.sameTransaction,
      second: payoutSummaryOf(parseJson(replay.responseJson)),
    })),
    permalinkPath: `/r/${run.id}`,
  };
}
