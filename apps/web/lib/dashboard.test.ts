import { describe, expect, it } from "vitest";
import { buildDashboard, percentile } from "./dashboard";
import { openStore, type Store, type VerificationRow } from "./store/store";

const WALLET = "0x54444762e6648a233338D5a4109Eb9612af50bF9";

function seedRun(store: Store, id: string, startedAt: string, status: "completed" | "failed" | "running", latency: number, confere: number) {
  store.createRun(id, startedAt);
  const finished = new Date(Date.parse(startedAt) + 15_000).toISOString();
  const steps = [
    ["deposit", { trackId: "t" }],
    ["settle", { settled: true }],
    ["deposit_confirm", { success: true, data: { value: 5400 } }],
    ["swap", { status: "COMPLETED" }],
    ["payout", { status: "COMPLETED", valueInBrl: "27.00" }],
  ] as const;
  for (const [name, body] of steps) {
    store.markStepSent(id, name, null, "{}", startedAt);
    store.markStepResult(id, name, { status: "ok", responseJson: JSON.stringify(body), httpStatus: 200, latencyMs: latency, errorCode: null, errorMessage: null }, finished);
  }
  const legs: VerificationRow["leg"][] = ["deposit_mint", "swap_debit", "swap_credit", "payout_debit"];
  legs.forEach((leg, i) =>
    store.saveVerification({
      runId: id,
      leg,
      step: "swap",
      txHash: `0x${String(i + 1).repeat(64)}`,
      token: leg.endsWith("debit") && leg !== "swap_debit" ? "USDH" : leg === "swap_credit" ? "USDH" : "BRLH",
      fromAddress: WALLET,
      toAddress: null,
      rawExpected: "54000000000000000000",
      rawObserved: "54000000000000000000",
      observedFrom: WALLET,
      observedTo: null,
      result: i < confere ? "confere" : "nao_conferido",
      reason: null,
      checkedAt: finished,
    }),
  );
  if (status !== "running") store.setRunStatus(id, status, finished);
}

describe("percentile", () => {
  it("nearest-rank", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 50)).toBe(5);
    expect(percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 95)).toBe(10);
  });
});

describe("buildDashboard", () => {
  it("resume execuções, volume, conferências, latência por passo e o que aconteceu por último", () => {
    const store = openStore(":memory:");
    seedRun(store, "aaaaaaaaaaaa", "2026-10-16T10:00:00.000Z", "completed", 1000, 4);
    seedRun(store, "bbbbbbbbbbbb", "2026-10-16T11:00:00.000Z", "completed", 3000, 3);
    seedRun(store, "cccccccccccc", "2026-10-16T12:00:00.000Z", "failed", 2000, 0);
    const d = buildDashboard(store, "2026-10-16T12:30:00.000Z");

    expect(d.generatedAt).toBe("2026-10-16T12:30:00.000Z");
    expect(d.runs).toEqual({ total: 3, completed: 2, failed: 1, interrupted: 0, running: 0, completedPct: 67 });
    expect(d.volume).toEqual({ inCents: "10800", pixOutCents: "5400", display: { in: "R$ 108,00", pixOut: "R$ 54,00" } });
    expect(d.verifications).toEqual({ total: 12, confere: 7, conferePct: 58 });
    expect(d.latency.map((l) => [l.name, l.p50Ms, l.p95Ms, l.samples])).toEqual([
      ["deposit", 2000, 3000, 3],
      ["settle", 2000, 3000, 3],
      ["deposit_confirm", 2000, 3000, 3],
      ["swap", 2000, 3000, 3],
      ["payout", 2000, 3000, 3],
    ]);
    expect(d.recentRuns.map((r) => [r.id, r.status, r.confere, r.legs, r.durationMs])).toEqual([
      ["cccccccccccc", "failed", 0, 4, 15_000],
      ["bbbbbbbbbbbb", "completed", 3, 4, 15_000],
      ["aaaaaaaaaaaa", "completed", 4, 4, 15_000],
    ]);
    expect(d.recentTransfers).toHaveLength(10);
    expect(d.recentTransfers[0]).toMatchObject({ runId: "cccccccccccc", explorerUrl: expect.stringMatching(/^https:\/\/sepolia\.basescan\.org\/tx\/0x/) });
  });

  it("banco vazio: zeros, sem porcentagens inventadas", () => {
    const d = buildDashboard(openStore(":memory:"), "2026-10-16T12:30:00.000Z");
    expect(d.runs).toEqual({ total: 0, completed: 0, failed: 0, interrupted: 0, running: 0, completedPct: null });
    expect(d.verifications.conferePct).toBeNull();
    expect(d.latency.every((l) => l.p50Ms === null && l.samples === 0)).toBe(true);
    expect(d.recentRuns).toEqual([]);
  });
});
