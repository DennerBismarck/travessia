import { z } from "zod";

const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimalString = z.string().regex(/^\d+(\.\d+)?$/);

export const DepositCreatedSchema = z.looseObject({
  externalId: z.string(),
  walletCharge: z.string(),
  trackId: z.string(),
  qrCode: z.string(),
  fee: z.number().int(),
  address,
  network: z.string(),
  sandbox: z.looseObject({ payable: z.boolean() }).optional(),
});
export type DepositCreated = z.output<typeof DepositCreatedSchema>;

const DepositSchema = z.looseObject({
  walletCharge: z.string(),
  trackId: z.string(),
  /** PENDING, FIAT_PAID, PROCESSING, COMPLETED, FAILED, REFUNDED ou EXPIRED. Mantido como string para não quebrar com estados novos. */
  status: z.string(),
  errorCode: z.string().nullable().optional(),
  asset: z.string(),
  address: address.nullable(),
  value: z.number().int(),
  fee: z.number().int(),
  transactionHash: txHash.nullable(),
  endToEndId: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  confirmedAt: z.string().nullable().optional(),
});
export const DepositStatusSchema = z
  .looseObject({ success: z.literal(true), data: DepositSchema })
  .transform((envelope) => envelope.data);
export type Deposit = z.output<typeof DepositStatusSchema>;

export const SettleResultSchema = z.looseObject({ received: z.boolean(), settled: z.boolean() });
export type SettleResult = z.output<typeof SettleResultSchema>;

export const SandboxSwapSchema = z.looseObject({
  swapId: z.string(),
  status: z.string(),
  fromAsset: z.string(),
  toAsset: z.string(),
  amountIn: decimalString,
  amountOut: decimalString,
  debitTxHash: txHash.nullable(),
  creditTxHash: txHash.nullable(),
  refundTxHash: txHash.nullable().optional(),
  walletAddress: address,
});
export type SandboxSwap = z.output<typeof SandboxSwapSchema>;

export const SwapResultSchema = z.looseObject({
  swapId: z.string(),
  status: z.string(),
  sandbox: SandboxSwapSchema.optional(),
});
export type SwapResult = z.output<typeof SwapResultSchema>;

export const PayoutResultSchema = z.looseObject({
  transactionId: z.string(),
  externalId: z.string().nullable().optional(),
  status: z.string(),
  stableAmount: decimalString.nullable().optional(),
  valueInBrl: decimalString,
  fee: decimalString,
  network: z.string(),
  asset: z.string(),
  endToEndId: z.string().nullable().optional(),
  txHash: txHash.nullable().optional(),
  alreadyProcessed: z.boolean().optional(),
});
export type PayoutResult = z.output<typeof PayoutResultSchema>;

export const WalletInfoSchema = z
  .looseObject({
    success: z.literal(true),
    data: z.looseObject({
      addresses: z.record(z.string(), address.nullable()),
      balances: z.array(z.looseObject({ network: z.string(), asset: z.string(), amount: decimalString })),
    }),
  })
  .transform((envelope) => envelope.data);
export type WalletInfo = z.output<typeof WalletInfoSchema>;

export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";
