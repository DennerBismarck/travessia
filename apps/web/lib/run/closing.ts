import { brlCentsToTokenRaw, parseDecimal, TOKEN_DECIMALS, tokenRawToBrlCents, type Token } from "@travessia/hodle/money";
import { asToken } from "./expectations";

export interface ClosingInput {
  deposit: { value: number; fee: number; asset: string };
  swap: { fromAsset: string; toAsset: string; amountIn: string; amountOut: string };
  payout: { valueInBrl: string; fee: string; stableAmount?: string | null; asset: string };
}

export interface Closing {
  inCents: bigint;
  pixOutCents: bigint;
  keptCents: bigint;
  feesCents: bigint;
  balanced: boolean;
}

/** entrou = saiu por Pix + guardado + taxas, calculado das respostas da API, em bigint. */
export function computeClosing(input: ClosingInput): Closing {
  const held: Record<Token, bigint> = { BRLH: 0n, USDH: 0n };
  const inCents = BigInt(input.deposit.value);
  const depositFee = BigInt(input.deposit.fee);
  const depositToken = asToken(input.deposit.asset);
  const fromToken = asToken(input.swap.fromAsset);
  const toToken = asToken(input.swap.toAsset);
  const payoutToken = asToken(input.payout.asset);
  if (!input.payout.stableAmount) throw new Error("saque sem stableAmount");

  held[depositToken] += brlCentsToTokenRaw(inCents - depositFee, depositToken);
  held[fromToken] -= parseDecimal(input.swap.amountIn, TOKEN_DECIMALS[fromToken]);
  held[toToken] += parseDecimal(input.swap.amountOut, TOKEN_DECIMALS[toToken]);
  held[payoutToken] -= parseDecimal(input.payout.stableAmount, TOKEN_DECIMALS[payoutToken]);

  const keptCents = tokenRawToBrlCents(held.BRLH, "BRLH") + tokenRawToBrlCents(held.USDH, "USDH");
  const pixOutCents = parseDecimal(input.payout.valueInBrl, 2);
  const feesCents = depositFee + parseDecimal(input.payout.fee, 2);
  return { inCents, pixOutCents, keptCents, feesCents, balanced: inCents === pixOutCents + keptCents + feesCents };
}
