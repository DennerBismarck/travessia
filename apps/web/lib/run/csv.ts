import { formatDecimal, TOKEN_DECIMALS, tokenRawToBrlCents } from "@travessia/hodle/money";
import type { RunView } from "./view";

export const CSV_HEADER = [
  "run_id",
  "passo",
  "operacao",
  "chave_idempotencia",
  "http_status",
  "status_api",
  "valor_brl",
  "ativo",
  "valor_ativo",
  "tx_hash",
  "end_to_end_id",
  "conferencia",
  "explorer_url",
] as const;

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const centsToDecimal = (cents: bigint): string => `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;

export function runToCsv(view: RunView): string {
  const rows = view.verifications.map((v) => {
    const step = view.steps.find((s) => s.name === v.step);
    const keyStep = v.step === "deposit_confirm" ? view.steps.find((s) => s.name === "deposit") : step;
    const raw = BigInt(v.apiSays.raw);
    return [
      view.id,
      v.step,
      v.label,
      keyStep?.idempotencyKey ?? "",
      step?.httpStatus?.toString() ?? "",
      step?.apiStatus ?? "",
      centsToDecimal(tokenRawToBrlCents(raw, v.token)),
      v.token,
      formatDecimal(raw, TOKEN_DECIMALS[v.token]),
      v.txHash,
      v.leg === "payout_debit" ? (view.payout?.endToEndId ?? "") : "",
      v.result,
      v.explorerUrl,
    ];
  });
  return [CSV_HEADER as readonly string[], ...rows].map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
