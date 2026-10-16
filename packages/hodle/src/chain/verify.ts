import { decodeEventLog, erc20Abi } from "viem";
import type { Token } from "../money";
import { TOKEN_ADDRESSES } from "./constants";

export interface LogLike {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface ReceiptLike {
  status: "success" | "reverted";
  logs: readonly LogLike[];
}

/** Devolve null enquanto a transação não foi minerada. */
export type ReceiptFetcher = (hash: `0x${string}`) => Promise<ReceiptLike | null>;

export interface TransferExpectation {
  token: Token;
  from?: string;
  to?: string;
  raw: bigint;
}

export interface ObservedTransfer {
  from: string;
  to: string;
  raw: bigint;
}

export type VerificationResult = "confere" | "diverge" | "nao_conferido";

export interface Verification {
  result: VerificationResult;
  observed: ObservedTransfer | null;
  reason: string | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export function decodeTransfers(receipt: ReceiptLike, token: Token): ObservedTransfer[] {
  const transfers: ObservedTransfer[] = [];
  for (const log of receipt.logs) {
    if (!same(log.address, TOKEN_ADDRESSES[token])) continue;
    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        eventName: "Transfer",
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      transfers.push({ from: decoded.args.from, to: decoded.args.to, raw: decoded.args.value });
    } catch {
      // outro evento do mesmo contrato (Approval etc.)
    }
  }
  return transfers;
}

export function matchTransfer(receipt: ReceiptLike, expected: TransferExpectation): Verification {
  if (receipt.status !== "success") return { result: "diverge", observed: null, reason: "a transação foi revertida" };
  const transfers = decodeTransfers(receipt, expected.token);
  if (transfers.length === 0) {
    return { result: "diverge", observed: null, reason: `nenhum Transfer de ${expected.token} na transação` };
  }
  const routed = transfers.filter(
    (t) => (!expected.from || same(t.from, expected.from)) && (!expected.to || same(t.to, expected.to)),
  );
  const exact = routed.find((t) => t.raw === expected.raw);
  if (exact) return { result: "confere", observed: exact, reason: null };
  return {
    result: "diverge",
    observed: routed[0] ?? transfers[0] ?? null,
    reason: routed.length > 0 ? "valor diferente do informado pela API" : "origem ou destino diferente do esperado",
  };
}

export async function verifyTransfer(
  fetchReceipt: ReceiptFetcher,
  hash: `0x${string}`,
  expected: TransferExpectation,
  options: { timeoutMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Verification> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let reason = "recibo ainda não disponível";
  for (;;) {
    try {
      const receipt = await fetchReceipt(hash);
      if (receipt) return matchTransfer(receipt, expected);
    } catch (error) {
      reason = `RPC indisponível: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`;
    }
    if (now() + intervalMs > deadline) return { result: "nao_conferido", observed: null, reason };
    await sleep(intervalMs);
  }
}
