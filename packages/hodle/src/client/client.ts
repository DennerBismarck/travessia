import { centsToJsonNumber } from "../money";
import {
  DepositCreatedSchema,
  DepositStatusSchema,
  PayoutResultSchema,
  SettleResultSchema,
  SwapResultSchema,
  WalletInfoSchema,
  type Deposit,
  type DepositCreated,
  type PayoutResult,
  type PixKeyType,
  type SettleResult,
  type SwapResult,
  type WalletInfo,
} from "./schemas";
import { createTransport, type CallOptions, type CallResult, type TransportOptions } from "./transport";

export const SANDBOX_API_URL = "https://sandbox-api.hodle.com.br";

export interface CreateDepositInput {
  valueCents: bigint;
  asset: "BRLH" | "USDH";
  externalId: string;
}

export interface SwapInput {
  fromAsset: string;
  toAsset: string;
  amount: string;
  clientRequestId: string;
}

export interface PayoutInput {
  valueCents: bigint;
  asset: string;
  network: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  externalId: string;
  walletPin?: string;
  protectedSymmetricKey?: string;
}

export interface HodleClient {
  readonly baseUrl: string;
  createDeposit(input: CreateDepositInput, options?: CallOptions): Promise<CallResult<DepositCreated>>;
  getDeposit(id: string, options?: CallOptions): Promise<CallResult<Deposit>>;
  settleSandboxDeposit(trackId: string, options?: CallOptions): Promise<CallResult<SettleResult>>;
  swap(input: SwapInput, options?: CallOptions): Promise<CallResult<SwapResult>>;
  createPayout(input: PayoutInput, options?: CallOptions): Promise<CallResult<PayoutResult>>;
  getWallet(input?: { sync?: boolean }, options?: CallOptions): Promise<CallResult<WalletInfo>>;
}

export function createHodleClient(options: TransportOptions): HodleClient {
  const transport = createTransport(options);
  return {
    baseUrl: transport.baseUrl,
    createDeposit: (input, callOptions) =>
      transport.call(
        "POST",
        "/api/deposit/asset",
        { value: centsToJsonNumber(input.valueCents), asset: input.asset, externalId: input.externalId },
        DepositCreatedSchema,
        callOptions,
      ),
    getDeposit: (id, callOptions) => transport.call("GET", `/api/deposit/${encodeURIComponent(id)}`, undefined, DepositStatusSchema, callOptions),
    settleSandboxDeposit: (trackId, callOptions) =>
      transport.call(
        "POST",
        "/avenia/webhook",
        { event: { subscription: "TICKET", data: { type: "DEPOSIT-SUCCESS", ticket: { id: trackId } } } },
        SettleResultSchema,
        callOptions,
      ),
    swap: (input, callOptions) =>
      transport.call(
        "POST",
        "/api/wallet/swap",
        { fromAsset: input.fromAsset, toAsset: input.toAsset, amount: input.amount, clientRequestId: input.clientRequestId },
        SwapResultSchema,
        callOptions,
      ),
    createPayout: (input, callOptions) => {
      const body: Record<string, unknown> = {
        value: centsToJsonNumber(input.valueCents),
        asset: input.asset,
        network: input.network,
        pixKey: input.pixKey,
        pixKeyType: input.pixKeyType,
        externalId: input.externalId,
      };
      if (input.walletPin) body.walletPin = input.walletPin;
      if (input.protectedSymmetricKey) body.protectedSymmetricKey = input.protectedSymmetricKey;
      const extraSecrets = [input.walletPin, input.protectedSymmetricKey].filter((s): s is string => Boolean(s));
      return transport.call("POST", "/api/wallet/payout", body, PayoutResultSchema, { ...callOptions, extraSecrets });
    },
    getWallet: (input, callOptions) =>
      transport.call("GET", input?.sync ? "/api/wallet?sync=true" : "/api/wallet", undefined, WalletInfoSchema, callOptions),
  };
}
