import { describe, expect, it } from "vitest";
import depositMint from "./__fixtures__/deposit-mint.json";
import payoutDebit from "./__fixtures__/payout-debit.json";
import swapCredit from "./__fixtures__/swap-credit.json";
import swapDebit from "./__fixtures__/swap-debit.json";
import { ZERO_ADDRESS } from "./constants";
import { createChainReader } from "./reader";
import { matchTransfer, verifyTransfer, type ReceiptLike } from "./verify";

const WALLET = "0x54444762e6648a233338D5a4109Eb9612af50bF9";
const SETTLEMENT = "0x356f41944a832e8705057151dc50fe838f671474";
const asReceipt = (fixture: { status: string; logs: { address: string; topics: string[]; data: string }[] }): ReceiptLike => ({
  status: fixture.status as ReceiptLike["status"],
  logs: fixture.logs,
});

describe("matchTransfer com os recibos reais", () => {
  it("mint do depósito: 1 BRLH de 0x0 para a carteira", () => {
    const v = matchTransfer(asReceipt(depositMint), { token: "BRLH", from: ZERO_ADDRESS, to: WALLET, raw: 10n ** 18n });
    expect(v.result).toBe("confere");
    expect(v.reason).toBeNull();
    expect(v.observed?.from).toBe(ZERO_ADDRESS);
    expect(v.observed?.to.toLowerCase()).toBe(WALLET.toLowerCase());
    expect(v.observed?.raw).toBe(10n ** 18n);
  });

  it("débito da troca: 0.54 BRLH saindo da carteira", () => {
    const v = matchTransfer(asReceipt(swapDebit), { token: "BRLH", from: WALLET, raw: 54n * 10n ** 16n });
    expect(v.result).toBe("confere");
    expect(v.observed?.to.toLowerCase()).toBe(SETTLEMENT);
  });

  it("crédito da troca: 0.1 USDH de 0x0 para a carteira", () => {
    expect(matchTransfer(asReceipt(swapCredit), { token: "USDH", from: ZERO_ADDRESS, to: WALLET, raw: 100_000n }).result).toBe("confere");
  });

  it("débito do saque: 0.05 USDH saindo da carteira", () => {
    expect(matchTransfer(asReceipt(payoutDebit), { token: "USDH", from: WALLET, raw: 50_000n }).result).toBe("confere");
  });

  it("valor diferente: diverge e mostra o observado", () => {
    const v = matchTransfer(asReceipt(payoutDebit), { token: "USDH", from: WALLET, raw: 50_001n });
    expect(v.result).toBe("diverge");
    expect(v.observed?.raw).toBe(50_000n);
    expect(v.reason).toBe("valor diferente do informado pela API");
  });

  it("token errado: diverge sem observado", () => {
    const v = matchTransfer(asReceipt(depositMint), { token: "USDH", raw: 1n });
    expect(v).toEqual({ result: "diverge", observed: null, reason: "nenhum Transfer de USDH na transação" });
  });

  it("destino errado: diverge", () => {
    const v = matchTransfer(asReceipt(depositMint), { token: "BRLH", to: SETTLEMENT, raw: 10n ** 18n });
    expect(v.result).toBe("diverge");
    expect(v.reason).toBe("origem ou destino diferente do esperado");
  });

  it("transação revertida: diverge", () => {
    const v = matchTransfer({ ...asReceipt(depositMint), status: "reverted" }, { token: "BRLH", raw: 10n ** 18n });
    expect(v).toEqual({ result: "diverge", observed: null, reason: "a transação foi revertida" });
  });
});

describe("verifyTransfer", () => {
  const fakeClock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };
  const hash = depositMint.hash as `0x${string}`;
  const expected = { token: "BRLH" as const, from: ZERO_ADDRESS, to: WALLET, raw: 10n ** 18n };

  it("espera o recibo aparecer", async () => {
    let calls = 0;
    const fetchReceipt = async () => (++calls < 3 ? null : asReceipt(depositMint));
    const v = await verifyTransfer(fetchReceipt, hash, expected, fakeClock());
    expect(v.result).toBe("confere");
    expect(calls).toBe(3);
  });

  it("RPC fora por 10 s: nao_conferido, com número limitado de tentativas", async () => {
    let calls = 0;
    const fetchReceipt = async () => {
      calls += 1;
      throw new Error("ECONNREFUSED");
    };
    const v = await verifyTransfer(fetchReceipt, hash, expected, fakeClock());
    expect(v).toEqual({ result: "nao_conferido", observed: null, reason: "RPC indisponível: ECONNREFUSED" });
    expect(calls).toBe(11);
  });
});

describe.skipIf(!process.env.LIVE_CHAIN)("leitor ao vivo (LIVE_CHAIN=1)", () => {
  it("lê o recibo real do mint na Base Sepolia", async () => {
    const reader = createChainReader();
    expect(await reader.getChainId()).toBe(84532);
    const receipt = await reader.fetchReceipt(depositMint.hash as `0x${string}`);
    expect(matchTransfer(receipt!, { token: "BRLH", from: ZERO_ADDRESS, to: WALLET, raw: 10n ** 18n }).result).toBe("confere");
  });
});
