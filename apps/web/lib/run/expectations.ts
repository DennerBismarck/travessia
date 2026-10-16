import { ZERO_ADDRESS } from "@travessia/hodle/chain";
import type { Deposit, PayoutResult, SandboxSwap } from "@travessia/hodle/client";
import { brlCentsToTokenRaw, parseDecimal, TOKEN_DECIMALS, type Token } from "@travessia/hodle/money";
import type { Leg, StepName } from "./steps";

export interface LegExpectation {
  leg: Leg;
  step: StepName;
  txHash: `0x${string}`;
  token: Token;
  from?: string;
  to?: string;
  raw: bigint;
}

export function asToken(value: string): Token {
  if (value === "BRLH" || value === "USDH") return value;
  throw new Error(`ativo fora do sandbox: ${value}`);
}

function hash(value: string | null | undefined, what: string): `0x${string}` {
  if (!value) throw new Error(`${what} sem hash`);
  return value as `0x${string}`;
}

/** O mint esperado vem do valor pedido: o sandbox não informa o valor recebido. */
export function depositExpectation(deposit: Deposit, wallet: string): LegExpectation {
  const token = asToken(deposit.asset);
  return {
    leg: "deposit_mint",
    step: "deposit_confirm",
    txHash: hash(deposit.transactionHash, "depósito"),
    token,
    from: ZERO_ADDRESS,
    to: wallet,
    raw: brlCentsToTokenRaw(BigInt(deposit.value) - BigInt(deposit.fee), token),
  };
}

export function swapExpectations(swap: SandboxSwap, wallet: string): LegExpectation[] {
  const from = asToken(swap.fromAsset);
  const to = asToken(swap.toAsset);
  return [
    { leg: "swap_debit", step: "swap", txHash: hash(swap.debitTxHash, "débito da troca"), token: from, from: wallet, raw: parseDecimal(swap.amountIn, TOKEN_DECIMALS[from]) },
    { leg: "swap_credit", step: "swap", txHash: hash(swap.creditTxHash, "crédito da troca"), token: to, from: ZERO_ADDRESS, to: wallet, raw: parseDecimal(swap.amountOut, TOKEN_DECIMALS[to]) },
  ];
}

export function payoutExpectation(payout: PayoutResult, wallet: string): LegExpectation {
  const token = asToken(payout.asset);
  if (!payout.stableAmount) throw new Error("saque sem stableAmount");
  return {
    leg: "payout_debit",
    step: "payout",
    txHash: hash(payout.txHash, "saque"),
    token,
    from: wallet,
    raw: parseDecimal(payout.stableAmount, TOKEN_DECIMALS[token]),
  };
}
