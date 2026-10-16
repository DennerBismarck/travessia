// Dinheiro sempre em bigint: centavos de BRL e unidades brutas de token.

export type Token = "BRLH" | "USDH";

export const TOKEN_DECIMALS: Readonly<Record<Token, number>> = { BRLH: 18, USDH: 6 };

/** Câmbio fixo do sandbox, 1 USD = 5,4 BRL, como fração exata. */
export const SANDBOX_FX = { brlPerUsdNum: 54n, brlPerUsdDen: 10n } as const;

export class MoneyError extends Error {
  override name = "MoneyError";
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);
const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;
const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** "0.05" com 6 casas → 50000n. Recusa sinal, notação científica e casas demais. */
export function parseDecimal(text: string, decimals: number): bigint {
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new MoneyError(`valor decimal inválido: ${JSON.stringify(text)}`);
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new MoneyError(`${text} tem mais de ${decimals} casas decimais`);
  return BigInt(whole) * pow10(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** 50000n com 6 casas → "0.05"; sem zeros à direita. */
export function formatDecimal(raw: bigint, decimals: number): string {
  if (raw < 0n) return `-${formatDecimal(-raw, decimals)}`;
  const base = pow10(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** Centavos de BRL → unidades brutas do token, truncando. */
export function brlCentsToTokenRaw(cents: bigint, token: Token): bigint {
  if (token === "BRLH") return cents * pow10(TOKEN_DECIMALS.BRLH - 2);
  return (cents * pow10(TOKEN_DECIMALS.USDH) * SANDBOX_FX.brlPerUsdDen) / (100n * SANDBOX_FX.brlPerUsdNum);
}

/** Unidades brutas do token → centavos de BRL, truncando. */
export function tokenRawToBrlCents(raw: bigint, token: Token): bigint {
  if (token === "BRLH") return raw / pow10(TOKEN_DECIMALS.BRLH - 2);
  return (raw * 100n * SANDBOX_FX.brlPerUsdNum) / (pow10(TOKEN_DECIMALS.USDH) * SANDBOX_FX.brlPerUsdDen);
}

/** Troca no câmbio fixo do sandbox, truncando como o sandbox faz. */
export function convertToken(raw: bigint, from: Token, to: Token): bigint {
  if (from === to) return raw;
  if (from === "BRLH") {
    return (raw * pow10(TOKEN_DECIMALS.USDH) * SANDBOX_FX.brlPerUsdDen) / (pow10(TOKEN_DECIMALS.BRLH) * SANDBOX_FX.brlPerUsdNum);
  }
  return (raw * pow10(TOKEN_DECIMALS.BRLH) * SANDBOX_FX.brlPerUsdNum) / (pow10(TOKEN_DECIMALS.USDH) * SANDBOX_FX.brlPerUsdDen);
}

/** 123456n → "R$ 1.234,56". */
export function formatBrl(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}R$ ${groupThousands((abs / 100n).toString())},${(abs % 100n).toString().padStart(2, "0")}`;
}

/** 50000n USDH → "0,05 USDH". */
export function formatToken(raw: bigint, token: Token): string {
  const [whole, fraction] = formatDecimal(raw, TOKEN_DECIMALS[token]).split(".");
  const grouped = groupThousands(whole!);
  return `${fraction ? `${grouped},${fraction}` : grouped} ${token}`;
}

/** Centavos para o corpo JSON da API, que exige número inteiro. */
export function centsToJsonNumber(cents: bigint): number {
  if (cents < 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`valor fora do intervalo aceito: ${cents}`);
  }
  return Number(cents);
}
