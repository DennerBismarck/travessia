import type { NextBody, StartBody } from "../http";
import type { RunView } from "../run/view";

export interface DriverDeps {
  post(path: string): Promise<{ status: number; body: unknown }>;
  sleep(ms: number): Promise<void>;
  onView(view: RunView): void;
  onNotice(text: string | null): void;
  maxBusyWaits?: number;
}

export type DriveOutcome =
  | { kind: "finished"; view: RunView }
  | { kind: "unavailable"; reason: string; lastCompletedRunId: string | null }
  | { kind: "interrupted"; view: RunView | null }
  | { kind: "error"; message: string };

/** Inicia a execução e chama next até o fim. Cada resposta já traz o passo executado e as conferências. */
export async function driveRun(deps: DriverDeps): Promise<DriveOutcome> {
  let runId: string | null = null;
  for (let attempt = 0; runId === null; attempt++) {
    const { status, body } = await deps.post("/api/runs");
    const start = body as StartBody;
    if (status === 201 && "runId" in start) {
      runId = start.runId;
    } else if (status === 409 && "retryAfterSec" in start && attempt < (deps.maxBusyWaits ?? 8)) {
      deps.onNotice(`Outra execução em andamento. Tentando de novo em ~${start.retryAfterSec} s.`);
      await deps.sleep(start.retryAfterSec * 1000);
    } else if (status === 503 && "lastCompletedRunId" in start) {
      return { kind: "unavailable", reason: start.error, lastCompletedRunId: start.lastCompletedRunId };
    } else {
      return { kind: "error", message: `Não foi possível iniciar (HTTP ${status}).` };
    }
  }
  deps.onNotice(null);

  let lastView: RunView | null = null;
  let networkFailures = 0;
  for (;;) {
    let response: { status: number; body: unknown };
    try {
      response = await deps.post(`/api/runs/${runId}/next`);
      networkFailures = 0;
    } catch {
      networkFailures += 1;
      if (networkFailures > 3) return { kind: "error", message: "Conexão perdida com o servidor." };
      await deps.sleep(2_000);
      continue;
    }
    const body = response.body as NextBody;
    if (response.status === 200 && "done" in body) {
      lastView = body.view;
      deps.onView(body.view);
      if (body.done) return { kind: "finished", view: body.view };
      if (body.retryAfterSec) {
        deps.onNotice(`Aguardando ${body.retryAfterSec} s para repetir com a mesma chave.`);
        await deps.sleep(body.retryAfterSec * 1000);
        deps.onNotice(null);
      }
      continue;
    }
    if (response.status === 409 && "error" in body && body.error === "step_in_progress") {
      await deps.sleep(1_000);
      continue;
    }
    if (response.status === 409 && "view" in body) return { kind: "interrupted", view: body.view ?? lastView };
    return { kind: "error", message: `Erro inesperado (HTTP ${response.status}).` };
  }
}
