// Painel de operação: o que passou pela Travessia, calculado do próprio banco.
import { explorerTxUrl } from "@travessia/hodle/chain";
import { formatBrl, formatToken, parseDecimal, type Token } from "@travessia/hodle/money";
import { LEG_LABEL, STEP_ORDER, type Leg, type StepName } from "./run/steps";
import type { RunStatus, Store } from "./store/store";
import { ttlCache } from "./ttl-cache";

export interface DashboardView {
  generatedAt: string;
  runs: { total: number; completed: number; failed: number; interrupted: number; running: number; completedPct: number | null };
  volume: { inCents: string; pixOutCents: string; display: { in: string; pixOut: string } };
  verifications: { total: number; confere: number; conferePct: number | null };
  latency: { name: StepName; p50Ms: number | null; p95Ms: number | null; samples: number }[];
  recentRuns: { id: string; status: RunStatus; startedAt: string; durationMs: number | null; confere: number; legs: number }[];
  recentTransfers: { runId: string; leg: Leg; label: string; txHash: string; explorerUrl: string; display: string; result: string; checkedAt: string }[];
}

type DashboardStore = Pick<
  Store,
  "runCounts" | "completedFlows" | "okStepLatencies" | "recentRunsSummary" | "recentVerifications" | "verificationCounts"
>;

/** Percentil pelo método nearest-rank. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

const percentOf = (part: number, whole: number): number | null => (whole === 0 ? null : Math.round((part / whole) * 100));

export function buildDashboard(store: DashboardStore, nowIso: string): DashboardView {
  const counts = store.runCounts();
  const total = counts.running + counts.completed + counts.failed + counts.interrupted;

  let inCents = 0n;
  let pixOutCents = 0n;
  for (const flow of store.completedFlows()) {
    if (typeof flow.depositValue === "number") inCents += BigInt(flow.depositValue);
    if (typeof flow.payoutValueInBrl === "string") {
      try {
        pixOutCents += parseDecimal(flow.payoutValueInBrl, 2);
      } catch {
        // resposta fora do formato: fica fora da soma
      }
    }
  }

  const latencies = store.okStepLatencies();
  const verificationCounts = store.verificationCounts();

  return {
    generatedAt: nowIso,
    runs: { total, ...counts, completedPct: percentOf(counts.completed, total) },
    volume: { inCents: inCents.toString(), pixOutCents: pixOutCents.toString(), display: { in: formatBrl(inCents), pixOut: formatBrl(pixOutCents) } },
    verifications: { ...verificationCounts, conferePct: percentOf(verificationCounts.confere, verificationCounts.total) },
    latency: STEP_ORDER.map((name) => {
      const values = latencies.filter((l) => l.name === name).map((l) => l.latencyMs);
      return { name, p50Ms: percentile(values, 50), p95Ms: percentile(values, 95), samples: values.length };
    }),
    recentRuns: store.recentRunsSummary(10).map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      durationMs: r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : null,
      confere: Number(r.confere),
      legs: Number(r.legs),
    })),
    recentTransfers: store.recentVerifications(10).map((v) => ({
      runId: v.runId,
      leg: v.leg,
      label: LEG_LABEL[v.leg],
      txHash: v.txHash,
      explorerUrl: explorerTxUrl(v.txHash),
      display: formatToken(BigInt(v.rawObserved ?? v.rawExpected), v.token as Token),
      result: v.result,
      checkedAt: v.checkedAt,
    })),
  };
}

export function createDashboardReader(store: DashboardStore, now: () => number = Date.now, ttlMs = 10_000) {
  const cached = ttlCache<DashboardView>(ttlMs, now);
  return { read: () => cached(async () => buildDashboard(store, new Date(now()).toISOString())) };
}
