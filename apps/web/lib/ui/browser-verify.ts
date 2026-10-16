// Conferência refeita pelo navegador do visitante, direto numa RPC pública, sem passar pelo servidor da Travessia.
import { matchTransfer, type ReceiptLike } from "@travessia/hodle/chain";
import { formatToken } from "@travessia/hodle/money";
import type { VerificationView } from "../run/view";
import { formatDateTimeBr } from "./labels";

export const PUBLIC_RPC_URLS = ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"] as const;

export interface BrowserCheck {
  leg: VerificationView["leg"];
  result: "confere" | "diverge" | "nao_conferido";
  blockNumber: string | null;
  time: string | null;
  from: string | null;
  to: string | null;
  display: string | null;
  reason: string | null;
}

export function checkLeg(
  leg: Pick<VerificationView, "leg" | "token" | "apiSays" | "expectedFrom" | "expectedTo">,
  fetched: { receipt: ReceiptLike; blockNumber: bigint; timestamp: bigint } | null,
  reason = "recibo não encontrado",
): BrowserCheck {
  if (!fetched) return { leg: leg.leg, result: "nao_conferido", blockNumber: null, time: null, from: null, to: null, display: null, reason };
  const v = matchTransfer(fetched.receipt, {
    token: leg.token,
    from: leg.expectedFrom ?? undefined,
    to: leg.expectedTo ?? undefined,
    raw: BigInt(leg.apiSays.raw),
  });
  return {
    leg: leg.leg,
    result: v.result,
    blockNumber: fetched.blockNumber.toString(),
    time: formatDateTimeBr(new Date(Number(fetched.timestamp) * 1000).toISOString()),
    from: v.observed?.from ?? null,
    to: v.observed?.to ?? null,
    display: v.observed ? formatToken(v.observed.raw, leg.token) : null,
    reason: v.reason,
  };
}
