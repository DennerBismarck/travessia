// Imita as rotas do sandbox usadas pela Travessia, com o formato real das respostas
// (ver packages/hodle/src/client/__fixtures__) e idempotência por chave, como o sandbox.
import { brlCentsToTokenRaw, convertToken, formatDecimal, parseDecimal } from "@travessia/hodle/money";

export const WALLET = "0x54444762e6648a233338D5a4109Eb9612af50bF9";
export const SETTLEMENT = "0x356f41944a832e8705057151dc50fe838f671474";
export const HASH = {
  mint: `0x${"a1".repeat(32)}`,
  debit: `0x${"b2".repeat(32)}`,
  credit: `0x${"c3".repeat(32)}`,
  payout: `0x${"d4".repeat(32)}`,
  refund: `0x${"e5".repeat(32)}`,
} as const;

export interface DoubleOptions {
  depositStaysPending?: boolean;
  swapError?: { status: number; body: unknown };
  rateLimitSwapOnce?: number;
  payoutStatus?: string;
  payoutError?: { status: number; body: unknown };
  /** O primeiro saque é aceito no servidor, mas a resposta nunca chega. */
  hangPayoutOnce?: boolean;
  onRequest?: (method: string, path: string, body: any) => void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const brl = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export function createSandboxDouble(options: DoubleOptions = {}) {
  const deposits = new Map<string, { trackId: string; value: number; settled: boolean }>();
  const swaps = new Map<string, unknown>();
  const payouts = new Map<string, unknown>();
  const calls: { method: string; path: string; body: any }[] = [];
  let payoutHung = false;
  let swapLimited = false;

  const payoutResponse = (body: any) => ({
    success: true,
    transactionId: `tx-${body.externalId}`,
    externalId: body.externalId,
    status: options.payoutStatus ?? "COMPLETED",
    stableAmount: formatDecimal(brlCentsToTokenRaw(BigInt(body.value), "USDH"), 6),
    valueInBrl: brl(body.value),
    fee: "0.00",
    network: "base-sepolia",
    asset: body.asset,
    endToEndId: "SANDBOXDOUBLE0000000000000000000",
    txHash: HASH.payout,
    sandbox: true,
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: url.pathname, body });
    options.onRequest?.(method, url.pathname, body);

    if (method === "POST" && url.pathname === "/api/deposit/asset") {
      let deposit = deposits.get(body.externalId);
      if (!deposit) {
        deposit = { trackId: `track-${body.externalId}`, value: body.value, settled: false };
        deposits.set(body.externalId, deposit);
      }
      return json(200, {
        success: true,
        externalId: body.externalId,
        walletCharge: `wc-${body.externalId}`,
        qrCode: "00020126580014br.gov.bcb.pix0136sandbox6304SBX0",
        trackId: deposit.trackId,
        fee: 0,
        fxRateAtTx: 5.4,
        address: WALLET,
        network: "base-sepolia",
        sandbox: { payable: false },
      });
    }

    if (method === "POST" && url.pathname === "/avenia/webhook") {
      const trackId = body.event.data.ticket.id;
      for (const deposit of deposits.values()) if (deposit.trackId === trackId) deposit.settled = true;
      return json(200, { received: true, settled: true });
    }

    if (method === "GET" && url.pathname.startsWith("/api/deposit/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/deposit/".length));
      const entry = [...deposits.entries()].find(([externalId, d]) => d.trackId === id || externalId === id);
      if (!entry) return json(404, { success: false, error: "Deposit not found" });
      const deposit = entry[1];
      const completed = deposit.settled && !options.depositStaysPending;
      return json(200, {
        success: true,
        data: {
          walletCharge: `wc-${entry[0]}`,
          trackId: deposit.trackId,
          status: completed ? "COMPLETED" : "PENDING",
          errorCode: null,
          asset: "BRLH",
          network: "base-sepolia",
          address: WALLET,
          value: deposit.value,
          fee: 0,
          transactionHash: completed ? HASH.mint : null,
          endToEndId: null,
          paidAt: null,
          confirmedAt: null,
        },
      });
    }

    if (method === "POST" && url.pathname === "/api/wallet/swap") {
      if (options.rateLimitSwapOnce && !swapLimited) {
        swapLimited = true;
        return json(429, { success: false, error: "Too many requests" }, { "retry-after": String(options.rateLimitSwapOnce) });
      }
      if (options.swapError) return json(options.swapError.status, options.swapError.body);
      const existing = swaps.get(body.clientRequestId);
      if (existing) return json(200, existing);
      const amountOut = formatDecimal(convertToken(parseDecimal(body.amount, 18), "BRLH", "USDH"), 6);
      const response = {
        success: true,
        swapId: `swap-${body.clientRequestId}`,
        status: "COMPLETED",
        legs: [],
        sandbox: {
          swapId: `swap-${body.clientRequestId}`,
          status: "COMPLETED",
          fromAsset: body.fromAsset,
          toAsset: body.toAsset,
          amountIn: body.amount,
          amountOut,
          fxRate: 5.4,
          debitTxHash: HASH.debit,
          creditTxHash: HASH.credit,
          refundTxHash: null,
          walletAddress: WALLET,
          network: "base-sepolia",
          chainId: 84532,
          sandbox: true,
        },
      };
      swaps.set(body.clientRequestId, response);
      return json(200, response);
    }

    if (method === "POST" && url.pathname === "/api/wallet/payout") {
      if (options.payoutError) return json(options.payoutError.status, options.payoutError.body);
      if (options.hangPayoutOnce && !payoutHung) {
        payoutHung = true;
        payouts.set(body.externalId, payoutResponse(body));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      const response = payouts.get(body.externalId) ?? payoutResponse(body);
      payouts.set(body.externalId, response);
      return json(202, response);
    }

    return json(404, { success: false, error: `rota não simulada: ${method} ${url.pathname}` });
  };

  return { fetch: fetchImpl, calls, payouts, swaps };
}
