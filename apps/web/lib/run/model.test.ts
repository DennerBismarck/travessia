import { describe, expect, it } from "vitest";
import type { ReplayRow, RunRow, StepRow, VerificationRow } from "../store/store";
import { computeClosing } from "./closing";
import { CSV_HEADER, csvCell, runToCsv } from "./csv";
import { depositExpectation, payoutExpectation, swapExpectations } from "./expectations";
import { buildRunView } from "./view";

const WALLET = "0x54444762e6648a233338D5a4109Eb9612af50bF9";
const ZERO = "0x0000000000000000000000000000000000000000";
const H = { mint: `0x${"a1".repeat(32)}`, debit: `0x${"b2".repeat(32)}`, credit: `0x${"c3".repeat(32)}`, payout: `0x${"d4".repeat(32)}`, refund: `0x${"e5".repeat(32)}` };
const RUN_ID = "abcdef123456";
const T0 = "2026-10-16T12:00:00.000Z";

const depositBody = { success: true, externalId: `trv-${RUN_ID}-dep`, walletCharge: "wc", qrCode: "000201", trackId: "track-1", fee: 0, address: WALLET, network: "base-sepolia", sandbox: { payable: false } };
const confirmBody = {
  success: true,
  data: { walletCharge: "wc", trackId: "track-1", status: "COMPLETED", asset: "BRLH", address: WALLET, value: 5400, fee: 0, transactionHash: H.mint },
};
const swapBody = {
  success: true,
  swapId: "s1",
  status: "COMPLETED",
  sandbox: { swapId: "s1", status: "COMPLETED", fromAsset: "BRLH", toAsset: "USDH", amountIn: "54", amountOut: "10", debitTxHash: H.debit, creditTxHash: H.credit, refundTxHash: null, walletAddress: WALLET },
};
const payoutBody = {
  success: true,
  transactionId: "tx-1",
  externalId: `trv-${RUN_ID}-pay`,
  status: "COMPLETED",
  stableAmount: "5",
  valueInBrl: "27.00",
  fee: "0.00",
  network: "base-sepolia",
  asset: "USDH",
  endToEndId: "SANDBOXABC",
  txHash: H.payout,
};

function step(name: StepRow["name"], body: unknown, extra: Partial<StepRow> = {}): StepRow {
  return {
    runId: RUN_ID,
    name,
    idempotencyKey: name === "deposit" ? `trv-${RUN_ID}-dep` : name === "swap" ? `trv-${RUN_ID}-swap` : name === "payout" ? `trv-${RUN_ID}-pay` : null,
    status: "ok",
    attempts: 1,
    requestJson: JSON.stringify({ method: "POST", path: "/x", url: "https://sandbox-api.hodle.com.br/x", headers: { Authorization: "Bearer [REDACTED]" }, body: {} }),
    responseJson: JSON.stringify(body),
    httpStatus: name === "payout" ? 202 : 200,
    latencyMs: 2400,
    errorCode: null,
    errorMessage: null,
    startedAt: T0,
    finishedAt: T0,
    ...extra,
  };
}

function verification(leg: VerificationRow["leg"], stepName: VerificationRow["step"], txHash: string, token: string, raw: string): VerificationRow {
  return { runId: RUN_ID, leg, step: stepName, txHash, token, fromAddress: null, toAddress: null, rawExpected: raw, rawObserved: raw, observedFrom: WALLET, observedTo: ZERO, result: "confere", reason: null, checkedAt: T0 };
}

const completedRun: RunRow = { id: RUN_ID, status: "completed", walletAddress: WALLET, startedAt: T0, finishedAt: "2026-10-16T12:00:14.200Z" };
const completedSteps = [
  step("deposit", depositBody),
  step("settle", { received: true, settled: true }),
  step("deposit_confirm", confirmBody),
  step("swap", swapBody),
  step("payout", payoutBody),
];
const completedVerifications = [
  verification("payout_debit", "payout", H.payout, "USDH", "5000000"),
  verification("deposit_mint", "deposit_confirm", H.mint, "BRLH", "54000000000000000000"),
  verification("swap_credit", "swap", H.credit, "USDH", "10000000"),
  verification("swap_debit", "swap", H.debit, "BRLH", "54000000000000000000"),
];

describe("expectativas a partir das respostas", () => {
  it("depósito, troca e saque", () => {
    expect(depositExpectation(confirmBody.data as never, WALLET)).toEqual({
      leg: "deposit_mint", step: "deposit_confirm", txHash: H.mint, token: "BRLH", from: ZERO, to: WALLET, raw: 54n * 10n ** 18n,
    });
    expect(swapExpectations(swapBody.sandbox as never, WALLET)).toEqual([
      { leg: "swap_debit", step: "swap", txHash: H.debit, token: "BRLH", from: WALLET, raw: 54n * 10n ** 18n },
      { leg: "swap_credit", step: "swap", txHash: H.credit, token: "USDH", from: ZERO, to: WALLET, raw: 10_000_000n },
    ]);
    expect(payoutExpectation(payoutBody as never, WALLET)).toEqual({
      leg: "payout_debit", step: "payout", txHash: H.payout, token: "USDH", from: WALLET, raw: 5_000_000n,
    });
  });
});

describe("computeClosing", () => {
  it("execução padrão fecha no centavo", () => {
    expect(
      computeClosing({ deposit: { value: 5400, fee: 0, asset: "BRLH" }, swap: swapBody.sandbox, payout: payoutBody }),
    ).toEqual({ inCents: 5400n, pixOutCents: 2700n, keptCents: 2700n, feesCents: 0n, balanced: true });
  });

  it("números reais das sondagens também fecham (R$ 1,00 = 0,27 + 0,46 BRLH + 0,05 USDH)", () => {
    const closing = computeClosing({
      deposit: { value: 100, fee: 0, asset: "BRLH" },
      swap: { fromAsset: "BRLH", toAsset: "USDH", amountIn: "0.54", amountOut: "0.1" },
      payout: { valueInBrl: "0.27", fee: "0.00", stableAmount: "0.05", asset: "USDH" },
    });
    expect(closing).toEqual({ inCents: 100n, pixOutCents: 27n, keptCents: 73n, feesCents: 0n, balanced: true });
  });

  it("detecta quando não fecha", () => {
    const closing = computeClosing({ deposit: { value: 5400, fee: 0, asset: "BRLH" }, swap: swapBody.sandbox, payout: { ...payoutBody, stableAmount: "6" } });
    expect(closing.balanced).toBe(false);
  });
});

describe("buildRunView", () => {
  it("execução recém-criada: cinco passos pendentes nos três atos", () => {
    const view = buildRunView({ run: { ...completedRun, status: "running", finishedAt: null }, steps: [], verifications: [], replays: [] });
    expect(view.steps.map((s) => [s.name, s.act, s.status])).toEqual([
      ["deposit", "receba", "pending"],
      ["settle", "receba", "pending"],
      ["deposit_confirm", "receba", "pending"],
      ["swap", "guarde", "pending"],
      ["payout", "pague", "pending"],
    ]);
    expect(view.closing).toBeNull();
    expect(view.durationMs).toBeNull();
  });

  it("execução concluída: conferências em ordem, fechamento e resumo do saque", () => {
    const view = buildRunView({ run: completedRun, steps: completedSteps, verifications: completedVerifications, replays: [] });
    expect(view.verifications.map((v) => v.leg)).toEqual(["deposit_mint", "swap_debit", "swap_credit", "payout_debit"]);
    expect(view.verifications[0]).toMatchObject({
      label: "Depósito: mint de BRLH",
      apiSays: { raw: "54000000000000000000", display: "54 BRLH", expected: true },
      chainSays: { raw: "54000000000000000000", display: "54 BRLH" },
      result: "confere",
      explorerUrl: `https://sepolia.basescan.org/tx/${H.mint}`,
    });
    expect(view.verifications[3]!.apiSays.expected).toBe(false);
    expect(view.closing).toEqual({
      balanced: true,
      cents: { in: "5400", pixOut: "2700", kept: "2700", fees: "0" },
      display: { in: "R$ 54,00", pixOut: "R$ 27,00", kept: "R$ 27,00", fees: "R$ 0,00" },
    });
    expect(view.payout).toEqual({ transactionId: "tx-1", txHash: H.payout, endToEndId: "SANDBOXABC", status: "COMPLETED" });
    expect(view.steps.find((s) => s.name === "deposit_confirm")!.apiStatus).toBe("COMPLETED");
    expect(view.steps.find((s) => s.name === "payout")!.apiStatus).toBe("COMPLETED");
    expect(view.durationMs).toBe(14_200);
    expect(view.walletExplorerUrl).toBe(`https://sepolia.basescan.org/address/${WALLET}`);
    expect(view.permalinkPath).toBe(`/r/${RUN_ID}`);
  });

  it("passo que falhou mantém os hashes que a API devolveu", () => {
    const failedSwap = step("swap", { success: false, errorCode: "SANDBOX_SWAP_REFUNDED", sandbox: { debitTxHash: H.debit, refundTxHash: H.refund } }, {
      status: "failed",
      httpStatus: 422,
      errorCode: "SANDBOX_SWAP_REFUNDED",
    });
    const view = buildRunView({ run: { ...completedRun, status: "failed" }, steps: [...completedSteps.slice(0, 3), failedSwap], verifications: [], replays: [] });
    const swap = view.steps.find((s) => s.name === "swap")!;
    expect(swap.status).toBe("failed");
    expect(swap.hashes).toEqual([
      { hash: H.debit, url: `https://sepolia.basescan.org/tx/${H.debit}` },
      { hash: H.refund, url: `https://sepolia.basescan.org/tx/${H.refund}` },
    ]);
    expect(view.closing).toBeNull();
  });

  it("conferência expõe origem e destino esperados para quem quiser refazer a checagem", () => {
    const row = { ...verification("swap_debit", "swap", H.debit, "BRLH", "54000000000000000000"), fromAddress: WALLET, toAddress: null };
    const view = buildRunView({ run: completedRun, steps: completedSteps, verifications: [row], replays: [] });
    expect(view.verifications[0]).toMatchObject({ expectedFrom: WALLET, expectedTo: null });
  });

  it("repetições do saque", () => {
    const replays: ReplayRow[] = [{ id: 1, runId: RUN_ID, responseJson: JSON.stringify(payoutBody), sameTransaction: true, createdAt: T0 }];
    const view = buildRunView({ run: completedRun, steps: completedSteps, verifications: completedVerifications, replays });
    expect(view.replays).toEqual([
      { at: T0, sameTransaction: true, second: { transactionId: "tx-1", txHash: H.payout, endToEndId: "SANDBOXABC", status: "COMPLETED" } },
    ]);
  });
});

describe("CSV", () => {
  it("cabeçalho da spec e uma linha por movimento on-chain", () => {
    const csv = runToCsv(buildRunView({ run: completedRun, steps: completedSteps, verifications: completedVerifications, replays: [] }));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(CSV_HEADER).toEqual([
      "run_id", "passo", "operacao", "chave_idempotencia", "http_status", "status_api", "valor_brl", "ativo", "valor_ativo", "tx_hash", "end_to_end_id", "conferencia", "explorer_url",
    ]);
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe(
      `${RUN_ID},deposit_confirm,Depósito: mint de BRLH,trv-${RUN_ID}-dep,200,COMPLETED,54.00,BRLH,54,${H.mint},,confere,https://sepolia.basescan.org/tx/${H.mint}`,
    );
    expect(lines[4]).toBe(
      `${RUN_ID},payout,Saque: débito de USDH,trv-${RUN_ID}-pay,202,COMPLETED,27.00,USDH,5,${H.payout},SANDBOXABC,confere,https://sepolia.basescan.org/tx/${H.payout}`,
    );
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("escapa vírgula, aspas e quebra de linha", () => {
    expect(csvCell("simples")).toBe("simples");
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
});
