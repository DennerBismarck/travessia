import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openStore } from "./store";

const T0 = "2026-10-16T12:00:00.000Z";
const T1 = "2026-10-16T12:00:05.000Z";

function verification(runId: string, result: "confere" | "nao_conferido") {
  return {
    runId,
    leg: "deposit_mint" as const,
    step: "deposit_confirm" as const,
    txHash: `0x${"a1".repeat(32)}`,
    token: "BRLH",
    fromAddress: "0x0000000000000000000000000000000000000000",
    toAddress: "0x54444762e6648a233338D5a4109Eb9612af50bF9",
    rawExpected: "54000000000000000000",
    rawObserved: result === "confere" ? "54000000000000000000" : null,
    observedFrom: null,
    observedTo: null,
    result,
    reason: null,
    checkedAt: T1,
  };
}

describe("store", () => {
  it("cria e lê execuções; status só sai de running", () => {
    const store = openStore(":memory:");
    store.createRun("aaaaaaaaaaaa", T0);
    expect(store.getRun("aaaaaaaaaaaa")).toEqual({ id: "aaaaaaaaaaaa", status: "running", walletAddress: null, startedAt: T0, finishedAt: null });
    expect(store.setRunStatus("aaaaaaaaaaaa", "completed", T1)).toBe(true);
    expect(store.setRunStatus("aaaaaaaaaaaa", "interrupted", T1)).toBe(false);
    expect(store.getRun("aaaaaaaaaaaa")?.status).toBe("completed");
    expect(store.lastCompletedRun()?.id).toBe("aaaaaaaaaaaa");
  });

  it("interrompe execuções que ficaram running (reinício do servidor)", () => {
    const store = openStore(":memory:");
    store.createRun("aaaaaaaaaaaa", T0);
    store.createRun("bbbbbbbbbbbb", T0);
    store.setRunStatus("bbbbbbbbbbbb", "failed", T1);
    expect(store.interruptRunning(T1)).toBe(1);
    expect(store.getRun("aaaaaaaaaaaa")?.status).toBe("interrupted");
  });

  it("conta execuções desde um instante e lembra a última carteira", () => {
    const store = openStore(":memory:");
    store.createRun("aaaaaaaaaaaa", "2026-10-15T23:59:59.000Z");
    store.createRun("bbbbbbbbbbbb", "2026-10-16T00:00:01.000Z");
    store.setRunWallet("bbbbbbbbbbbb", "0x54444762e6648a233338D5a4109Eb9612af50bF9");
    expect(store.countRunsSince("2026-10-16T00:00:00.000Z")).toBe(1);
    expect(store.lastWalletAddress()).toBe("0x54444762e6648a233338D5a4109Eb9612af50bF9");
  });

  it("grava o passo como sent antes e com o resultado depois; tentativas somam", () => {
    const store = openStore(":memory:");
    store.createRun("aaaaaaaaaaaa", T0);
    store.markStepSent("aaaaaaaaaaaa", "payout", "trv-aaaaaaaaaaaa-pay", '{"method":"POST"}', T0);
    expect(store.getStep("aaaaaaaaaaaa", "payout")).toMatchObject({ status: "sent", attempts: 1, idempotencyKey: "trv-aaaaaaaaaaaa-pay" });
    store.markStepResult("aaaaaaaaaaaa", "payout", { status: "unknown", responseJson: null, httpStatus: null, latencyMs: 60000, errorCode: "TIMEOUT", errorMessage: "sem resposta em 60 s" }, T1);
    store.markStepSent("aaaaaaaaaaaa", "payout", "trv-aaaaaaaaaaaa-pay", '{"method":"POST"}', T1);
    store.markStepResult("aaaaaaaaaaaa", "payout", { status: "ok", responseJson: '{"status":"COMPLETED"}', httpStatus: 202, latencyMs: 2400, errorCode: null, errorMessage: null }, T1);
    expect(store.getStep("aaaaaaaaaaaa", "payout")).toMatchObject({ status: "ok", attempts: 2, httpStatus: 202, errorCode: null, finishedAt: T1 });
    expect(store.getSteps("aaaaaaaaaaaa").map((s) => s.name)).toEqual(["payout"]);
  });

  it("recusa mudar a chave de idempotência de um passo", () => {
    const store = openStore(":memory:");
    store.createRun("aaaaaaaaaaaa", T0);
    store.markStepSent("aaaaaaaaaaaa", "swap", "trv-aaaaaaaaaaaa-swap", "{}", T0);
    expect(() => store.markStepSent("aaaaaaaaaaaa", "swap", "outra-chave", "{}", T1)).toThrow(/não pode mudar/);
  });

  it("conferências: upsert por perna", () => {
    const store = openStore(":memory:");
    store.createRun("aaaaaaaaaaaa", T0);
    store.saveVerification(verification("aaaaaaaaaaaa", "nao_conferido"));
    store.saveVerification(verification("aaaaaaaaaaaa", "confere"));
    const rows = store.getVerifications("aaaaaaaaaaaa");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leg: "deposit_mint", result: "confere", rawObserved: "54000000000000000000" });
  });

  it("repetições do saque", () => {
    const store = openStore(":memory:");
    store.createRun("aaaaaaaaaaaa", T0);
    store.addReplay("aaaaaaaaaaaa", '{"transactionId":"t1"}', true, T1);
    expect(store.getReplays("aaaaaaaaaaaa")).toEqual([
      { id: 1, runId: "aaaaaaaaaaaa", responseJson: '{"transactionId":"t1"}', sameTransaction: true, createdAt: T1 },
    ]);
  });

  it("persiste em arquivo, criando o diretório", () => {
    const path = join(mkdtempSync(join(tmpdir(), "store-")), "sub", "travessia.sqlite");
    const first = openStore(path);
    first.createRun("aaaaaaaaaaaa", T0);
    first.close();
    const second = openStore(path);
    expect(second.getRun("aaaaaaaaaaaa")?.status).toBe("running");
    second.close();
  });
});
