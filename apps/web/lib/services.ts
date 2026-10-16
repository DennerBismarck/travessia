import "server-only";
import { createChainReader, verifyTransfer } from "@travessia/hodle/chain";
import { createHodleClient } from "@travessia/hodle/client";
import { loadConfig, type AppConfig } from "./config";
import { createDashboardReader } from "./dashboard";
import { createHealthChecker } from "./health";
import { createRunLock } from "./run/lock";
import { createOrchestrator, type Orchestrator } from "./run/orchestrator";
import { openStore, type Store } from "./store/store";
import { createWalletReader } from "./wallet";

export interface Services {
  config: AppConfig;
  store: Store;
  orchestrator: Orchestrator;
  wallet: ReturnType<typeof createWalletReader>;
  health: ReturnType<typeof createHealthChecker>;
  dashboard: ReturnType<typeof createDashboardReader>;
}

function createServices(config: AppConfig): Services {
  const store = openStore(config.databasePath);
  // A trava vive na memória: o que ficou running antes de um reinício não tem mais dono.
  store.interruptRunning(new Date().toISOString());
  const lock = createRunLock({ onExpire: (runId) => store.setRunStatus(runId, "interrupted", new Date().toISOString()) });
  const client = createHodleClient({ apiKey: config.apiKey, baseUrl: config.apiUrl });
  const chain = createChainReader(config.rpcUrls);
  const orchestrator = createOrchestrator({
    client,
    store,
    lock,
    verify: (hash, expected, options) => verifyTransfer(chain.fetchReceipt, hash, expected, options),
    pixKey: config.pixKeyDemo,
    dailyRunCap: config.dailyRunCap,
    killSwitch: config.killSwitch,
  });
  return {
    config,
    store,
    orchestrator,
    wallet: createWalletReader({ client, chain, store }),
    health: createHealthChecker({ client, chain, store }),
    dashboard: createDashboardReader(store),
  };
}

// Em desenvolvimento o Next recarrega módulos; a trava e o banco precisam ser únicos no processo.
const globalForServices = globalThis as typeof globalThis & { __travessia?: Services };

export function getServices(): Services {
  globalForServices.__travessia ??= createServices(loadConfig());
  return globalForServices.__travessia;
}
