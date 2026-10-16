import { describe, expect, it } from "vitest";
import { createHealthChecker } from "./health";

const store = { lastCompletedRun: () => ({ id: "abcdef123456" }) as never };

describe("createHealthChecker", () => {
  it("sandbox e RPC alcançáveis", async () => {
    const health = createHealthChecker({ client: { getWallet: async () => ({}) as never }, chain: { getChainId: async () => 84532 }, store, now: () => 0 });
    expect(await health.check()).toEqual({ sandbox: true, rpc: true, checkedAt: "1970-01-01T00:00:00.000Z", lastCompletedRunId: "abcdef123456" });
  });

  it("sandbox fora e RPC em outra rede", async () => {
    const health = createHealthChecker({
      client: { getWallet: async () => Promise.reject(new Error("down")) },
      chain: { getChainId: async () => 1 },
      store: { lastCompletedRun: () => undefined },
      now: () => 0,
    });
    expect(await health.check()).toMatchObject({ sandbox: false, rpc: false, lastCompletedRunId: null });
  });
});
