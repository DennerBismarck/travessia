import { BASE_SEPOLIA_CHAIN_ID, type ChainReader } from "@travessia/hodle/chain";
import type { HodleClient } from "@travessia/hodle/client";
import type { Store } from "./store/store";
import { ttlCache } from "./ttl-cache";

export interface HealthView {
  sandbox: boolean;
  rpc: boolean;
  checkedAt: string;
  lastCompletedRunId: string | null;
}

export function createHealthChecker(deps: {
  client: Pick<HodleClient, "getWallet">;
  chain: Pick<ChainReader, "getChainId">;
  store: Pick<Store, "lastCompletedRun">;
  now?: () => number;
  ttlMs?: number;
}) {
  const now = deps.now ?? Date.now;
  const cached = ttlCache<Omit<HealthView, "lastCompletedRunId">>(deps.ttlMs ?? 30_000, now);
  return {
    async check(): Promise<HealthView> {
      const probe = await cached(async () => {
        const [sandbox, rpc] = await Promise.all([
          deps.client.getWallet().then(
            () => true,
            () => false,
          ),
          deps.chain.getChainId().then(
            (id) => id === BASE_SEPOLIA_CHAIN_ID,
            () => false,
          ),
        ]);
        return { sandbox, rpc, checkedAt: new Date(now()).toISOString() };
      });
      return { ...probe, lastCompletedRunId: deps.store.lastCompletedRun()?.id ?? null };
    },
  };
}
