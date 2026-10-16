import { explorerAddressUrl, type ChainReader } from "@travessia/hodle/chain";
import type { HodleClient } from "@travessia/hodle/client";
import { formatToken } from "@travessia/hodle/money";
import type { Store } from "./store/store";
import { ttlCache } from "./ttl-cache";

export interface WalletView {
  address: string | null;
  explorerUrl: string | null;
  balances: { BRLH: string; USDH: string } | null;
  readAt: string;
  error: "api" | "rpc" | null;
}

export function createWalletReader(deps: {
  client: Pick<HodleClient, "getWallet">;
  chain: Pick<ChainReader, "getBalances">;
  store: Pick<Store, "lastWalletAddress">;
  now?: () => number;
  ttlMs?: number;
}) {
  const now = deps.now ?? Date.now;
  const cached = ttlCache<WalletView>(deps.ttlMs ?? 10_000, now);
  let address: string | null = null;

  async function resolveAddress(): Promise<string | null> {
    if (address) return address;
    address = deps.store.lastWalletAddress();
    if (address) return address;
    const wallet = await deps.client.getWallet();
    address = wallet.data.addresses["base-sepolia"] ?? null;
    return address;
  }

  return {
    read: () =>
      cached(async (): Promise<WalletView> => {
        const readAt = new Date(now()).toISOString();
        let resolved: string | null;
        try {
          resolved = await resolveAddress();
        } catch {
          return { address: null, explorerUrl: null, balances: null, readAt, error: "api" };
        }
        if (!resolved) return { address: null, explorerUrl: null, balances: null, readAt, error: null };
        const explorerUrl = explorerAddressUrl(resolved);
        try {
          const raw = await deps.chain.getBalances(resolved as `0x${string}`);
          return { address: resolved, explorerUrl, balances: { BRLH: formatToken(raw.BRLH, "BRLH"), USDH: formatToken(raw.USDH, "USDH") }, readAt, error: null };
        } catch {
          return { address: resolved, explorerUrl, balances: null, readAt, error: "rpc" };
        }
      }),
  };
}
