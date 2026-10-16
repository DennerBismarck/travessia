import { describe, expect, it } from "vitest";
import type { RunView } from "./run/view";
import { nextHttp, replayHttp, startHttp, toResponse } from "./http";

const view = { id: "abcdef123456" } as RunView;

describe("mapeamento HTTP", () => {
  it("start", () => {
    expect(startHttp({ kind: "started", runId: "abcdef123456" })).toEqual({ status: 201, body: { runId: "abcdef123456" } });
    expect(startHttp({ kind: "busy", retryAfterSec: 15 })).toEqual({
      status: 409,
      body: { error: "busy", retryAfterSec: 15 },
      headers: { "Retry-After": "15" },
    });
    expect(startHttp({ kind: "unavailable", reason: "daily_cap", lastCompletedRunId: "x" })).toEqual({
      status: 503,
      body: { error: "daily_cap", lastCompletedRunId: "x" },
    });
  });

  it("next", () => {
    expect(nextHttp({ kind: "progressed", view, retryAfterSec: 2 })).toEqual({ status: 200, body: { done: false, view, retryAfterSec: 2 } });
    expect(nextHttp({ kind: "finished", view })).toEqual({ status: 200, body: { done: true, view, retryAfterSec: null } });
    expect(nextHttp({ kind: "busy", view })).toEqual({ status: 409, body: { error: "step_in_progress", view } });
    expect(nextHttp({ kind: "not_holder", view })).toEqual({ status: 409, body: { error: "interrupted", view } });
    expect(nextHttp({ kind: "not_found" })).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("replay", () => {
    expect(replayHttp({ kind: "replayed", view, sameTransaction: true })).toEqual({ status: 200, body: { sameTransaction: true, view } });
    expect(replayHttp({ kind: "refused", reason: "não" })).toEqual({ status: 409, body: { error: "refused", reason: "não" } });
    expect(replayHttp({ kind: "error", code: "TIMEOUT", message: "sem resposta" })).toEqual({ status: 502, body: { error: "TIMEOUT", message: "sem resposta" } });
    expect(replayHttp({ kind: "not_found" })).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("toResponse nunca deixa cachear", async () => {
    const response = toResponse({ status: 409, body: { a: 1 }, headers: { "Retry-After": "15" } });
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("15");
    expect(await response.json()).toEqual({ a: 1 });
  });
});
