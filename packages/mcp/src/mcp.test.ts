import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HodleError, type HodleClient } from "@travessia/hodle/client";
import { describe, expect, it, vi } from "vitest";
import { ConfigError, loadMcpConfig, type McpConfig } from "./config";
import { createMcpServer } from "./server";
import { buildTools, type ToolDef } from "./tools";

const KEY = "hodle_test_UNITTESTKEY1234567890";

const config = (over: Partial<McpConfig> = {}): McpConfig => ({
  apiKey: KEY,
  apiUrl: "https://sandbox-api.hodle.com.br",
  allowWrites: true,
  walletPin: null,
  protectedSymmetricKey: null,
  isSandbox: true,
  ...over,
});

function fakeClient() {
  const result = (body: unknown) => Promise.resolve({ data: body, body, request: {} as never, httpStatus: 200, latencyMs: 1, headers: {} });
  return {
    baseUrl: "https://sandbox-api.hodle.com.br",
    getWallet: vi.fn(() => result({ success: true, data: { addresses: {}, balances: [] } })),
    getDeposit: vi.fn(() => result({ success: true, data: { status: "COMPLETED" } })),
    createDeposit: vi.fn(() => result({ trackId: "t1" })),
    settleSandboxDeposit: vi.fn(() => result({ received: true, settled: true })),
    swap: vi.fn(() => result({ status: "COMPLETED" })),
    createPayout: vi.fn((input: { walletPin?: string }) => result({ status: "COMPLETED", echo: input.walletPin ?? null })),
  };
}

const asClient = (fake: ReturnType<typeof fakeClient>) => fake as unknown as HodleClient;

function tool(tools: ToolDef[], name: string): ToolDef {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`ferramenta ausente: ${name}`);
  return found;
}

const payoutArgs = { value: 54, asset: "USDH", network: "base", pixKey: "recebedor@example.com", pixKeyType: "EMAIL", externalId: "x-pay" };

describe("ferramentas", () => {
  it("sem HODLE_MCP_ALLOW_WRITES só existem as leituras", () => {
    expect(buildTools(config({ allowWrites: false }), asClient(fakeClient())).map((t) => t.name)).toEqual(["hodle_wallet_get", "hodle_deposit_status"]);
  });

  it("com escrita ligada: as seis ferramentas", () => {
    expect(buildTools(config(), asClient(fakeClient())).map((t) => t.name)).toEqual([
      "hodle_wallet_get",
      "hodle_deposit_status",
      "hodle_deposit_asset",
      "hodle_sandbox_settle",
      "hodle_wallet_swap",
      "hodle_wallet_payout",
    ]);
  });

  it("escrita sem confirm: recusa sem requisição e descreve o que faria", async () => {
    const fake = fakeClient();
    const result = await tool(buildTools(config(), asClient(fake)), "hodle_deposit_asset").handler({ value: 108, asset: "BRLH", externalId: "x-dep" });
    expect(result).toEqual({
      isError: true,
      payload: {
        refused: true,
        reason: "confirm: true ausente: nada foi enviado.",
        wouldCall: { method: "POST", path: "/api/deposit/asset", body: { value: 108, asset: "BRLH", externalId: "x-dep" } },
      },
    });
    expect(fake.createDeposit).not.toHaveBeenCalled();
  });

  it("com confirm: executa com centavos em bigint", async () => {
    const fake = fakeClient();
    const result = await tool(buildTools(config(), asClient(fake)), "hodle_deposit_asset").handler({ value: 108, asset: "BRLH", externalId: "x-dep", confirm: true });
    expect(result).toEqual({ isError: false, payload: { trackId: "t1" } });
    expect(fake.createDeposit).toHaveBeenCalledWith({ valueCents: 108n, asset: "BRLH", externalId: "x-dep" });
  });

  it("saque recusa subAccountId mesmo com confirm", async () => {
    const fake = fakeClient();
    const result = await tool(buildTools(config(), asClient(fake)), "hodle_wallet_payout").handler({ ...payoutArgs, subAccountId: "sub-1", confirm: true });
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({ refused: true });
    expect(fake.createPayout).not.toHaveBeenCalled();
  });

  it("saque com ativo de produção exige PIN e chave no ambiente; a saída mascara o PIN", async () => {
    const fake = fakeClient();
    const withoutPin = await tool(buildTools(config(), asClient(fake)), "hodle_wallet_payout").handler({ ...payoutArgs, asset: "USDC", confirm: true });
    expect(withoutPin.payload).toMatchObject({ refused: true });
    expect(fake.createPayout).not.toHaveBeenCalled();

    const tools = buildTools(config({ walletPin: "654321", protectedSymmetricKey: "psk-secret-value" }), asClient(fake));
    const result = await tool(tools, "hodle_wallet_payout").handler({ ...payoutArgs, asset: "USDC", confirm: true });
    expect(fake.createPayout).toHaveBeenCalledWith(expect.objectContaining({ walletPin: "654321", protectedSymmetricKey: "psk-secret-value" }));
    expect(result.payload).toEqual({ status: "COMPLETED", echo: "[REDACTED]" });
  });

  it("settle e troca só no sandbox", async () => {
    const fake = fakeClient();
    const tools = buildTools(config({ apiUrl: "https://api.hodle.com.br", isSandbox: false }), asClient(fake));
    const settle = await tool(tools, "hodle_sandbox_settle").handler({ trackId: "t1", confirm: true });
    const swap = await tool(tools, "hodle_wallet_swap").handler({ fromAsset: "BRLH", toAsset: "USDH", amount: "1", clientRequestId: "s", confirm: true });
    expect([settle.payload, swap.payload]).toEqual([expect.objectContaining({ refused: true }), expect.objectContaining({ refused: true })]);
    expect(fake.settleSandboxDeposit).not.toHaveBeenCalled();
    expect(fake.swap).not.toHaveBeenCalled();
  });

  it("timeout numa escrita: outcomeUnknown com instrução de conferir antes de repetir", async () => {
    const fake = fakeClient();
    fake.createPayout.mockRejectedValueOnce(
      new HodleError({
        message: "sem resposta em 60 s",
        status: null,
        code: "TIMEOUT",
        details: null,
        requestId: null,
        retryAfter: null,
        outcomeUnknown: true,
        request: { method: "POST", path: "/api/wallet/payout", url: "https://sandbox-api.hodle.com.br/api/wallet/payout", headers: {}, body: null },
        latencyMs: 60_000,
      }),
    );
    const result = await tool(buildTools(config(), asClient(fake)), "hodle_wallet_payout").handler({ ...payoutArgs, confirm: true });
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({ code: "TIMEOUT", outcomeUnknown: true });
    expect((result.payload as { nextStep: string }).nextStep).toContain("MESMO externalId");
  });
});

describe("configuração", () => {
  it("chave obrigatória, sandbox e escrita desligada por padrão", () => {
    expect(() => loadMcpConfig({})).toThrow(ConfigError);
    expect(loadMcpConfig({ HODLE_API_KEY: KEY })).toEqual({
      apiKey: KEY,
      apiUrl: "https://sandbox-api.hodle.com.br",
      allowWrites: false,
      walletPin: null,
      protectedSymmetricKey: null,
      isSandbox: true,
    });
    expect(loadMcpConfig({ HODLE_API_KEY: KEY, HODLE_API_URL: "https://api.hodle.com.br", HODLE_MCP_ALLOW_WRITES: "true" })).toMatchObject({
      isSandbox: false,
      allowWrites: true,
    });
  });
});

describe("servidor MCP em memória", () => {
  it("lista as ferramentas com anotações e responde a uma chamada", async () => {
    const server = createMcpServer(config({ allowWrites: false }), asClient(fakeClient()));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "teste", version: "0.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["hodle_wallet_get", "hodle_deposit_status"]);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);

    const result = await client.callTool({ name: "hodle_wallet_get", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({ success: true, data: { addresses: {}, balances: [] } });
    await client.close();
  });
});
