import { describe, expect, it, vi } from "vitest";
import { createWalletReader } from "./wallet";

const WALLET = "0x54444762e6648a233338D5a4109Eb9612af50bF9";
const balances = async () => ({ BRLH: 46n * 10n ** 16n, USDH: 50_000n });

describe("createWalletReader", () => {
  it("usa o endereço da última execução sem chamar a API e formata os saldos", async () => {
    const getWallet = vi.fn();
    const reader = createWalletReader({ client: { getWallet }, chain: { getBalances: balances }, store: { lastWalletAddress: () => WALLET }, now: () => 0 });
    expect(await reader.read()).toEqual({
      address: WALLET,
      explorerUrl: `https://sepolia.basescan.org/address/${WALLET}`,
      balances: { BRLH: "0,46 BRLH", USDH: "0,05 USDH" },
      readAt: "1970-01-01T00:00:00.000Z",
      error: null,
    });
    expect(getWallet).not.toHaveBeenCalled();
  });

  it("sem execução anterior, pergunta à API; sem carteira ainda, devolve address null", async () => {
    const getWallet = vi.fn(async () => ({ data: { addresses: {}, balances: [] } }));
    const reader = createWalletReader({ client: { getWallet } as never, chain: { getBalances: balances }, store: { lastWalletAddress: () => null }, now: () => 0 });
    expect(await reader.read()).toMatchObject({ address: null, balances: null, error: null });
  });

  it("RPC fora: mantém o endereço e marca error rpc", async () => {
    const reader = createWalletReader({
      client: { getWallet: vi.fn() },
      chain: { getBalances: async () => Promise.reject(new Error("rpc")) },
      store: { lastWalletAddress: () => WALLET },
      now: () => 0,
    });
    expect(await reader.read()).toMatchObject({ address: WALLET, balances: null, error: "rpc" });
  });

  it("guarda por 10 s", async () => {
    let t = 0;
    const getBalances = vi.fn(balances);
    const reader = createWalletReader({ client: { getWallet: vi.fn() }, chain: { getBalances }, store: { lastWalletAddress: () => WALLET }, now: () => t });
    await reader.read();
    t = 9_000;
    await reader.read();
    expect(getBalances).toHaveBeenCalledTimes(1);
    t = 10_001;
    await reader.read();
    expect(getBalances).toHaveBeenCalledTimes(2);
  });
});
