// Uma execução por vez: a carteira de teste é compartilhada.
// O lease conta a partir do fim do último passo e nunca vence com um passo em andamento
// (um timeout de escrita pode levar 60 s).

export type AcquireResult = { ok: true } | { ok: false; holder: string; retryAfterSec: number };

export interface RunLock {
  acquire(runId: string, nowMs: number): AcquireResult;
  holds(runId: string, nowMs: number): boolean;
  tryBeginStep(runId: string): boolean;
  endStep(runId: string, nowMs: number): void;
  release(runId: string): void;
  current(nowMs: number): string | null;
}

export function createRunLock(options: { leaseMs?: number; onExpire: (runId: string) => void }): RunLock {
  const leaseMs = options.leaseMs ?? 45_000;
  let state: { runId: string; inFlight: boolean; lastActivityMs: number } | null = null;

  const expireIfStale = (nowMs: number): void => {
    if (state && !state.inFlight && nowMs - state.lastActivityMs > leaseMs) {
      const expired = state.runId;
      state = null;
      options.onExpire(expired);
    }
  };

  return {
    acquire(runId, nowMs) {
      expireIfStale(nowMs);
      if (state) return { ok: false, holder: state.runId, retryAfterSec: 15 };
      state = { runId, inFlight: false, lastActivityMs: nowMs };
      return { ok: true };
    },
    holds(runId, nowMs) {
      expireIfStale(nowMs);
      return state?.runId === runId;
    },
    tryBeginStep(runId) {
      if (!state || state.runId !== runId || state.inFlight) return false;
      state.inFlight = true;
      return true;
    },
    endStep(runId, nowMs) {
      if (state?.runId !== runId) return;
      state.inFlight = false;
      state.lastActivityMs = nowMs;
    },
    release(runId) {
      if (state?.runId === runId) state = null;
    },
    current(nowMs) {
      expireIfStale(nowMs);
      return state?.runId ?? null;
    },
  };
}
