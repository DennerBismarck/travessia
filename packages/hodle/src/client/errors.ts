export interface CallRecord {
  method: "GET" | "POST";
  path: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface HodleErrorInit {
  message: string;
  status: number | null;
  code: string | null;
  details: unknown;
  requestId: string | null;
  retryAfter: number | null;
  outcomeUnknown: boolean;
  request: CallRecord;
  latencyMs: number;
}

/** Mesmo contrato de erro do SDK oficial, mais o registro da requisição. */
export class HodleError extends Error {
  override name = "HodleError";
  readonly status: number | null;
  readonly code: string | null;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryAfter: number | null;
  readonly outcomeUnknown: boolean;
  readonly request: CallRecord;
  readonly latencyMs: number;

  constructor(init: HodleErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
    this.outcomeUnknown = init.outcomeUnknown;
    this.request = init.request;
    this.latencyMs = init.latencyMs;
  }
}
