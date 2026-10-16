import type { z } from "zod";
import { HodleError, type CallRecord } from "./errors";
import { redact } from "./redact";

export interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  now?: () => number;
}

export interface CallOptions {
  /** Chamado uma vez, logo antes do fetch, com o registro já redigido. */
  onSend?: (record: CallRecord) => void;
}

export interface CallResult<T> {
  data: T;
  /** Corpo JSON como veio, redigido. É o que a UI mostra em "ver código". */
  body: unknown;
  request: CallRecord;
  httpStatus: number;
  latencyMs: number;
  headers: Record<string, string>;
}

export interface Transport {
  readonly baseUrl: string;
  call<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    options?: CallOptions & { extraSecrets?: readonly string[] },
  ): Promise<CallResult<T>>;
}

const KEPT_HEADERS = ["x-request-id", "retry-after", "ratelimit-remaining", "x-hodle-sandbox"];

function parseRetryAfter(value: string | undefined, nowMs: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - nowMs) / 1000));
}

function parseJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createTransport(options: TransportOptions): Transport {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => performance.now());
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    callOptions: CallOptions & { extraSecrets?: readonly string[] } = {},
  ): Promise<CallResult<T>> {
    const secrets = [options.apiKey, ...(callOptions.extraSecrets ?? [])];
    const isWrite = method === "POST";
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${options.apiKey}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const request: CallRecord = redact({ method, path, url, headers, body: body ?? null }, secrets);
    const timeoutMs = isWrite ? (options.writeTimeoutMs ?? 60_000) : (options.readTimeoutMs ?? 15_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    const fail = (init: Omit<ConstructorParameters<typeof HodleError>[0], "request" | "latencyMs">): HodleError =>
      new HodleError({ ...init, message: redact(init.message, secrets), details: redact(init.details, secrets), request, latencyMs: now() - started });

    callOptions.onSend?.(request);
    let response: Response;
    let text: string;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      const timedOut = controller.signal.aborted;
      throw fail({
        message: timedOut ? `sem resposta em ${timeoutMs / 1000} s` : "falha de rede ao chamar a API",
        status: null,
        code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        details: null,
        requestId: null,
        retryAfter: null,
        outcomeUnknown: isWrite,
      });
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = now() - started;
    const kept: Record<string, string> = {};
    for (const name of KEPT_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) kept[name] = value;
    }
    const parsed = parseJson(text);
    const envelope = (parsed ?? {}) as { success?: unknown; error?: unknown; errorCode?: unknown };
    const requestId = kept["x-request-id"] ?? null;
    const retryAfter = parseRetryAfter(kept["retry-after"], Date.now());

    if (!response.ok || envelope.success === false) {
      throw fail({
        message: typeof envelope.error === "string" ? envelope.error : `HTTP ${response.status}`,
        status: response.status,
        code: typeof envelope.errorCode === "string" ? envelope.errorCode : null,
        details: parsed ?? text,
        requestId,
        retryAfter,
        outcomeUnknown: isWrite && response.status >= 500,
      });
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw fail({
        message: "resposta fora do formato esperado",
        status: response.status,
        code: "INVALID_RESPONSE",
        details: { issues: result.error.issues, body: parsed ?? text },
        requestId,
        retryAfter,
        outcomeUnknown: isWrite,
      });
    }

    return {
      data: redact(result.data, secrets),
      body: redact(parsed, secrets),
      request,
      httpStatus: response.status,
      latencyMs,
      headers: kept,
    };
  }

  return { baseUrl, call };
}
