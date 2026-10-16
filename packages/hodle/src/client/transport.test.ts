import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HodleError } from "./errors";
import { createTransport } from "./transport";

const API_KEY = "hodle_test_UNITTESTKEY1234567890";
const Ok = z.looseObject({ ok: z.boolean() });

function respond(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function hang(): typeof fetch {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
}

const transport = (fetchImpl: typeof fetch) =>
  createTransport({ apiKey: API_KEY, baseUrl: "https://sandbox.test/", fetch: fetchImpl, readTimeoutMs: 20, writeTimeoutMs: 20 });

async function caught(promise: Promise<unknown>): Promise<HodleError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HodleError) return error;
    throw error;
  }
  throw new Error("esperava HodleError");
}

describe("transporte", () => {
  it("devolve dados validados e um registro da requisição sem a chave", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(init!);
      return new Response(JSON.stringify({ ok: true, extra: 1 }), { status: 200, headers: { "x-request-id": "req-1" } });
    };
    const result = await transport(fetchImpl).call("POST", "/api/x", { value: 1 }, Ok);
    expect(result.data).toEqual({ ok: true, extra: 1 });
    expect(result.httpStatus).toBe(200);
    expect(result.headers["x-request-id"]).toBe("req-1");
    expect(result.request).toEqual({
      method: "POST",
      path: "/api/x",
      url: "https://sandbox.test/api/x",
      headers: { Authorization: "Bearer [REDACTED]", "Content-Type": "application/json" },
      body: { value: 1 },
    });
    expect((seen[0]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("chama onSend uma vez, antes do fetch", async () => {
    const order: string[] = [];
    const fetchImpl: typeof fetch = async () => {
      order.push("fetch");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await transport(fetchImpl).call("GET", "/api/x", undefined, Ok, { onSend: () => order.push("onSend") });
    expect(order).toEqual(["onSend", "fetch"]);
  });

  it("4xx vira HodleError com errorCode e sem outcomeUnknown", async () => {
    const error = await caught(
      transport(respond(400, { success: false, error: "Saldo insuficiente de USDH na carteira de teste", errorCode: "SANDBOX_INSUFFICIENT_BALANCE" })).call("POST", "/p", {}, Ok),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("SANDBOX_INSUFFICIENT_BALANCE");
    expect(error.message).toBe("Saldo insuficiente de USDH na carteira de teste");
    expect(error.outcomeUnknown).toBe(false);
  });

  it("lê Retry-After em segundos", async () => {
    const error = await caught(transport(respond(429, { success: false, error: "slow down" }, { "retry-after": "3" })).call("POST", "/p", {}, Ok));
    expect(error.retryAfter).toBe(3);
  });

  it("5xx: incerto numa escrita, não numa leitura", async () => {
    expect((await caught(transport(respond(503, {})).call("POST", "/p", {}, Ok))).outcomeUnknown).toBe(true);
    expect((await caught(transport(respond(503, {})).call("GET", "/p", undefined, Ok))).outcomeUnknown).toBe(false);
  });

  it("timeout numa escrita: TIMEOUT e outcomeUnknown", async () => {
    const error = await caught(transport(hang()).call("POST", "/p", {}, Ok));
    expect(error.code).toBe("TIMEOUT");
    expect(error.status).toBeNull();
    expect(error.outcomeUnknown).toBe(true);
  });

  it("erro de rede numa leitura: NETWORK_ERROR sem outcomeUnknown", async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const error = await caught(transport(failing).call("GET", "/p", undefined, Ok));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.outcomeUnknown).toBe(false);
  });

  it("2xx fora do schema numa escrita: INVALID_RESPONSE e outcomeUnknown", async () => {
    const error = await caught(transport(respond(200, { nope: 1 })).call("POST", "/p", {}, Ok));
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.outcomeUnknown).toBe(true);
  });

  it("success:false com 200 também é erro", async () => {
    const error = await caught(transport(respond(200, { success: false, error: "x", errorCode: "Y" })).call("GET", "/p", undefined, Ok));
    expect(error.code).toBe("Y");
  });

  it("mascara segredos ecoados pela API", async () => {
    const echo = respond(200, { ok: true, walletPin: "123456", note: `chave ${API_KEY}` });
    const result = await transport(echo).call("POST", "/p", { walletPin: "123456" }, Ok, { extraSecrets: ["123456"] });
    expect(result.body).toEqual({ ok: true, walletPin: "[REDACTED]", note: "chave [REDACTED]" });
    expect(result.request.body).toEqual({ walletPin: "[REDACTED]" });
  });

  it("mascara a chave em mensagens de erro", async () => {
    const error = await caught(transport(respond(401, { success: false, error: `invalid key ${API_KEY}` })).call("GET", "/p", undefined, Ok));
    expect(error.message).toBe("invalid key [REDACTED]");
    expect(JSON.stringify(error.details)).not.toContain(API_KEY);
  });
});
