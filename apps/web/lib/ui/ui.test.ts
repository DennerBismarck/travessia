import { describe, expect, it } from "vitest";
import type { RunView, StepView } from "../run/view";
import { driveRun } from "./driver";
import { explainError, formatSeconds, railProgress, runStatusText, stepStatusLabel, verificationLabel } from "./labels";
import { toCurl, toTypeScript } from "./snippets";

const step = (name: StepView["name"], status: StepView["status"], extra: Partial<StepView> = {}): StepView => ({
  name,
  act: "receba",
  status,
  attempts: 1,
  idempotencyKey: null,
  httpStatus: 200,
  latencyMs: 2900,
  errorCode: null,
  errorMessage: null,
  apiStatus: null,
  request: null,
  response: null,
  hashes: [],
  ...extra,
});

const viewWith = (statuses: StepView["status"][], extra: Partial<RunView> = {}): RunView =>
  ({
    id: "abcdef123456",
    status: "running",
    steps: (["deposit", "settle", "deposit_confirm", "swap", "payout"] as const).map((n, i) => step(n, statuses[i] ?? "pending")),
    verifications: [],
    replays: [],
    durationMs: null,
    ...extra,
  }) as RunView;

describe("textos", () => {
  it("status do passo", () => {
    expect(stepStatusLabel(step("payout", "ok", { apiStatus: "COMPLETED", httpStatus: 202 }))).toEqual({ text: "COMPLETED", tone: "ok" });
    expect(stepStatusLabel(step("settle", "ok"))).toEqual({ text: "HTTP 200", tone: "ok" });
    expect(stepStatusLabel(step("payout", "failed", { errorCode: "SANDBOX_INSUFFICIENT_BALANCE" }))).toEqual({ text: "SANDBOX_INSUFFICIENT_BALANCE", tone: "fail" });
    expect(stepStatusLabel(step("payout", "unknown", { errorCode: "TIMEOUT", httpStatus: null })).text).toBe("resultado incerto: conferindo antes de repetir");
    expect(stepStatusLabel(step("swap", "unknown", { httpStatus: 429 })).text).toBe("limite de requisições: aguardando para repetir");
  });

  it("conferência", () => {
    expect(verificationLabel("confere")).toEqual({ text: "confere", tone: "ok" });
    expect(verificationLabel("nao_conferido")).toEqual({ text: "ainda não conferido", tone: "warn" });
    expect(verificationLabel("diverge")).toEqual({ text: "diverge", tone: "fail" });
  });

  it("erros conhecidos e desconhecidos", () => {
    expect(explainError("SANDBOX_INSUFFICIENT_BALANCE")).toBe("A carteira de teste não tem saldo suficiente para esta operação.");
    expect(explainError("PAYOUT_FAILED")).toBe("A API devolveu o status FAILED.");
    expect(explainError("ALGO_NOVO")).toBe("Erro devolvido pela API.");
  });

  it("tempo em segundos no formato brasileiro", () => {
    expect(formatSeconds(2900)).toBe("2,9 s");
    expect(formatSeconds(14_234)).toBe("14,2 s");
  });

  it("progresso do trilho acompanha o último passo concluído", () => {
    expect(railProgress(null)).toBe(0);
    expect(railProgress(viewWith(["ok", "ok", "ok"]))).toBe(21);
    expect(railProgress(viewWith(["ok", "ok", "ok", "ok", "ok"]))).toBe(100);
  });

  it("linha de status da execução", () => {
    expect(runStatusText("running", viewWith(["ok", "ok"]))).toBe("Executando: confirmando o depósito…");
    expect(runStatusText("done", viewWith(["ok", "ok", "ok", "ok", "ok"], { status: "completed", durationMs: 14_234 }))).toBe("Travessia concluída em 14,2 s.");
    expect(runStatusText("done", viewWith(["ok", "failed"], { status: "failed" }))).toMatch(/parou num erro/);
  });
});

describe("ver código", () => {
  const request = {
    method: "POST" as const,
    path: "/api/wallet/payout",
    url: "https://sandbox-api.hodle.com.br/api/wallet/payout",
    headers: { Authorization: "Bearer [REDACTED]", "Content-Type": "application/json" },
    body: { value: 2700, asset: "USDH", externalId: "trv-abcdef123456-pay" },
  };

  it("curl com a chave vinda do ambiente", () => {
    expect(toCurl(request)).toBe(
      [
        "curl --request POST \\",
        "  --url https://sandbox-api.hodle.com.br/api/wallet/payout \\",
        '  --header "Authorization: Bearer $HODLE_API_KEY" \\',
        '  --header "Content-Type: application/json" \\',
        `  --data '{"value":2700,"asset":"USDH","externalId":"trv-abcdef123456-pay"}'`,
      ].join("\n"),
    );
    expect(toCurl({ ...request, method: "GET", body: null })).toBe(
      ["curl --request GET \\", "  --url https://sandbox-api.hodle.com.br/api/wallet/payout \\", '  --header "Authorization: Bearer $HODLE_API_KEY"'].join("\n"),
    );
  });

  it("TypeScript com fetch", () => {
    const code = toTypeScript(request);
    expect(code).toContain('const response = await fetch("https://sandbox-api.hodle.com.br/api/wallet/payout", {');
    expect(code).toContain("Authorization: `Bearer ${process.env.HODLE_API_KEY}`,");
    expect(code).toContain('"externalId": "trv-abcdef123456-pay"');
    expect(code).not.toContain("[REDACTED]");
  });
});

describe("driveRun", () => {
  const view = (done: boolean) => ({ id: "abcdef123456", status: done ? "completed" : "running" }) as RunView;

  function script(responses: { status: number; body: unknown }[]) {
    const paths: string[] = [];
    const sleeps: number[] = [];
    const notices: (string | null)[] = [];
    const views: RunView[] = [];
    const deps = {
      post: async (path: string) => {
        paths.push(path);
        const next = responses.shift();
        if (!next) throw new Error("sem resposta");
        if (next.status === 0) throw new TypeError("network");
        return next;
      },
      sleep: async (ms: number) => void sleeps.push(ms),
      onView: (v: RunView) => void views.push(v),
      onNotice: (n: string | null) => void notices.push(n),
    };
    return { deps, paths, sleeps, notices, views };
  }

  it("inicia e chama next até terminar", async () => {
    const s = script([
      { status: 201, body: { runId: "abcdef123456" } },
      { status: 200, body: { done: false, view: view(false), retryAfterSec: null } },
      { status: 200, body: { done: true, view: view(true), retryAfterSec: null } },
    ]);
    expect(await driveRun(s.deps)).toEqual({ kind: "finished", view: view(true) });
    expect(s.paths).toEqual(["/api/runs", "/api/runs/abcdef123456/next", "/api/runs/abcdef123456/next"]);
    expect(s.views).toHaveLength(2);
  });

  it("ocupado: avisa, espera e tenta de novo", async () => {
    const s = script([
      { status: 409, body: { error: "busy", retryAfterSec: 15 } },
      { status: 201, body: { runId: "abcdef123456" } },
      { status: 200, body: { done: true, view: view(true), retryAfterSec: null } },
    ]);
    expect((await driveRun(s.deps)).kind).toBe("finished");
    expect(s.sleeps).toEqual([15_000]);
    expect(s.notices[0]).toBe("Outra execução em andamento. Tentando de novo em ~15 s.");
  });

  it("Retry-After do passo: espera antes do próximo next", async () => {
    const s = script([
      { status: 201, body: { runId: "abcdef123456" } },
      { status: 200, body: { done: false, view: view(false), retryAfterSec: 2 } },
      { status: 200, body: { done: true, view: view(true), retryAfterSec: null } },
    ]);
    await driveRun(s.deps);
    expect(s.sleeps).toEqual([2_000]);
  });

  it("indisponível (teto ou kill switch)", async () => {
    const s = script([{ status: 503, body: { error: "daily_cap", lastCompletedRunId: "aaaaaaaaaaaa" } }]);
    expect(await driveRun(s.deps)).toEqual({ kind: "unavailable", reason: "daily_cap", lastCompletedRunId: "aaaaaaaaaaaa" });
  });

  it("interrompida", async () => {
    const s = script([
      { status: 201, body: { runId: "abcdef123456" } },
      { status: 409, body: { error: "interrupted", view: view(false) } },
    ]);
    expect(await driveRun(s.deps)).toEqual({ kind: "interrupted", view: view(false) });
  });

  it("rede caiu já no início: devolve erro em vez de travar", async () => {
    const s = script([{ status: 0, body: null }]);
    expect(await driveRun(s.deps)).toEqual({ kind: "error", message: "Não foi possível falar com o servidor. Tente de novo." });
  });

  it("rede caiu: tenta 3 vezes e desiste com mensagem", async () => {
    const s = script([{ status: 201, body: { runId: "abcdef123456" } }, { status: 0, body: null }, { status: 0, body: null }, { status: 0, body: null }, { status: 0, body: null }]);
    expect(await driveRun(s.deps)).toEqual({ kind: "error", message: "Conexão perdida com o servidor." });
  });
});
