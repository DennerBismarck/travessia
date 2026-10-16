import type { NextResult, ReplayResult, StartResult } from "./run/orchestrator";
import type { RunView } from "./run/view";

export interface HttpResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type StartBody =
  | { runId: string }
  | { error: "busy"; retryAfterSec: number }
  | { error: "kill_switch" | "daily_cap"; lastCompletedRunId: string | null };

export type NextBody =
  | { done: boolean; view: RunView; retryAfterSec: number | null }
  | { error: "step_in_progress" | "interrupted"; view: RunView }
  | { error: "not_found" };

export type ReplayBody =
  | { sameTransaction: boolean; view: RunView }
  | { error: "refused"; reason: string }
  | { error: string | null; message: string }
  | { error: "not_found" };

export function startHttp(result: StartResult): HttpResult {
  switch (result.kind) {
    case "started":
      return { status: 201, body: { runId: result.runId } satisfies StartBody };
    case "busy":
      return {
        status: 409,
        body: { error: "busy", retryAfterSec: result.retryAfterSec } satisfies StartBody,
        headers: { "Retry-After": String(result.retryAfterSec) },
      };
    case "unavailable":
      return { status: 503, body: { error: result.reason, lastCompletedRunId: result.lastCompletedRunId } satisfies StartBody };
  }
}

export function nextHttp(result: NextResult): HttpResult {
  switch (result.kind) {
    case "progressed":
      return { status: 200, body: { done: false, view: result.view, retryAfterSec: result.retryAfterSec } satisfies NextBody };
    case "finished":
      return { status: 200, body: { done: true, view: result.view, retryAfterSec: null } satisfies NextBody };
    case "busy":
      return { status: 409, body: { error: "step_in_progress", view: result.view } satisfies NextBody };
    case "not_holder":
      return { status: 409, body: { error: "interrupted", view: result.view } satisfies NextBody };
    case "not_found":
      return { status: 404, body: { error: "not_found" } satisfies NextBody };
  }
}

export function replayHttp(result: ReplayResult): HttpResult {
  switch (result.kind) {
    case "replayed":
      return { status: 200, body: { sameTransaction: result.sameTransaction, view: result.view } satisfies ReplayBody };
    case "refused":
      return { status: 409, body: { error: "refused", reason: result.reason } satisfies ReplayBody };
    case "error":
      return { status: 502, body: { error: result.code, message: result.message } satisfies ReplayBody };
    case "not_found":
      return { status: 404, body: { error: "not_found" } satisfies ReplayBody };
  }
}

export function toResponse(result: HttpResult): Response {
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store", ...result.headers } });
}
