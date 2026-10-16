import { describe, expect, it } from "vitest";
import depositCompleted from "./__fixtures__/deposit-completed.json";
import depositCreated from "./__fixtures__/deposit-created.json";
import depositPending from "./__fixtures__/deposit-pending.json";
import payoutCompleted from "./__fixtures__/payout-completed.json";
import settle from "./__fixtures__/settle.json";
import swapCompleted from "./__fixtures__/swap-completed.json";
import wallet from "./__fixtures__/wallet.json";
import { createHodleClient } from "./client";

const API_KEY = "hodle_test_UNITTESTKEY1234567890";

interface Captured {
  method: string;
  url: string;
  body: unknown;
}

function serve(status: number, body: unknown) {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, client: createHodleClient({ apiKey: API_KEY, baseUrl: "https://sandbox-api.hodle.com.br", fetch: fetchImpl }) };
}

describe("createHodleClient", () => {
  it("createDeposit envia centavos inteiros e lê a resposta real", async () => {
    const { calls, client } = serve(200, depositCreated);
    const result = await client.createDeposit({ valueCents: 5400n, asset: "BRLH", externalId: "trv-abc-dep" });
    expect(calls[0]).toEqual({
      method: "POST",
      url: "https://sandbox-api.hodle.com.br/api/deposit/asset",
      body: { value: 5400, asset: "BRLH", externalId: "trv-abc-dep" },
    });
    expect(result.data.trackId).toBe("0f6f6335-7532-428a-a954-e865b20800eb");
    expect(result.data.address).toBe("0x54444762e6648a233338D5a4109Eb9612af50bF9");
    expect(result.data.sandbox?.payable).toBe(false);
  });

  it("getDeposit devolve o objeto data, PENDING e COMPLETED", async () => {
    const pending = await serve(200, depositPending).client.getDeposit("0f6f6335-7532-428a-a954-e865b20800eb");
    expect(pending.data.status).toBe("PENDING");
    expect(pending.data.transactionHash).toBeNull();
    const { calls, client } = serve(200, depositCompleted);
    const done = await client.getDeposit("trv abc/dep");
    expect(calls[0]!.url).toBe("https://sandbox-api.hodle.com.br/api/deposit/trv%20abc%2Fdep");
    expect(done.data.status).toBe("COMPLETED");
    expect(done.data.value).toBe(100);
    expect(done.data.transactionHash).toBe("0xd995a51e94b1a952e040c29269e8a4f22c888574f2c0dbba4fba708ee5373dd9");
    expect(done.body).toEqual(depositCompleted);
  });

  it("settleSandboxDeposit envia o evento TICKET exatamente como a doc do sandbox", async () => {
    const { calls, client } = serve(200, settle);
    const result = await client.settleSandboxDeposit("track-1");
    expect(calls[0]).toEqual({
      method: "POST",
      url: "https://sandbox-api.hodle.com.br/avenia/webhook",
      body: { event: { subscription: "TICKET", data: { type: "DEPOSIT-SUCCESS", ticket: { id: "track-1" } } } },
    });
    expect(result.data.settled).toBe(true);
  });

  it("swap lê o recibo do sandbox", async () => {
    const { calls, client } = serve(200, swapCompleted);
    const result = await client.swap({ fromAsset: "BRLH", toAsset: "USDH", amount: "0.54", clientRequestId: "trv-abc-swap" });
    expect(calls[0]!.body).toEqual({ fromAsset: "BRLH", toAsset: "USDH", amount: "0.54", clientRequestId: "trv-abc-swap" });
    expect(result.data.status).toBe("COMPLETED");
    expect(result.data.sandbox?.amountOut).toBe("0.1");
    expect(result.data.sandbox?.debitTxHash).toBe("0x08c51aedd56d7a000393998786201bf215ccf6f0f3bda548ad18e207aaa867d0");
  });

  it("createPayout aceita 202 e só envia PIN quando informado", async () => {
    const { calls, client } = serve(202, payoutCompleted);
    const result = await client.createPayout({
      valueCents: 27n,
      asset: "USDH",
      network: "base",
      pixKey: "demo@example.com",
      pixKeyType: "EMAIL",
      externalId: "probe-pay-001",
    });
    expect(calls[0]!.body).toEqual({ value: 27, asset: "USDH", network: "base", pixKey: "demo@example.com", pixKeyType: "EMAIL", externalId: "probe-pay-001" });
    expect(result.httpStatus).toBe(202);
    expect(result.data.transactionId).toBe("6ad1455c6a71bd1aaf024449");
    expect(result.data.stableAmount).toBe("0.05");
    expect(result.data.endToEndId).toBe("SANDBOXC1AFC9E3A44E4A798E957AACF");
  });

  it("createPayout com PIN: envia de verdade, mas o registro mostra [REDACTED]", async () => {
    const { calls, client } = serve(202, payoutCompleted);
    const result = await client.createPayout({
      valueCents: 27n,
      asset: "USDC",
      network: "base",
      pixKey: "demo@example.com",
      pixKeyType: "EMAIL",
      externalId: "x",
      walletPin: "654321",
      protectedSymmetricKey: "psk-secret-value",
    });
    expect((calls[0]!.body as { walletPin: string }).walletPin).toBe("654321");
    expect(result.request.body).toMatchObject({ walletPin: "[REDACTED]", protectedSymmetricKey: "[REDACTED]" });
  });

  it("getWallet com e sem sync", async () => {
    const first = serve(200, wallet);
    const result = await first.client.getWallet();
    expect(first.calls[0]!.url).toBe("https://sandbox-api.hodle.com.br/api/wallet");
    expect(result.data.addresses["base-sepolia"]).toBe("0x54444762e6648a233338D5a4109Eb9612af50bF9");
    const second = serve(200, wallet);
    await second.client.getWallet({ sync: true });
    expect(second.calls[0]!.url).toBe("https://sandbox-api.hodle.com.br/api/wallet?sync=true");
  });
});
