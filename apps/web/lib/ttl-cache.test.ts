import { describe, expect, it } from "vitest";
import { ttlCache } from "./ttl-cache";

describe("ttlCache", () => {
  it("reaproveita dentro da validade e recarrega depois", async () => {
    let t = 0;
    let loads = 0;
    const cached = ttlCache<number>(10_000, () => t);
    const load = async () => ++loads;
    expect(await cached(load)).toBe(1);
    t = 9_999;
    expect(await cached(load)).toBe(1);
    t = 10_000;
    expect(await cached(load)).toBe(2);
  });

  it("deduplica cargas simultâneas", async () => {
    let loads = 0;
    const cached = ttlCache<number>(10_000, () => 0);
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return loads;
    };
    expect(await Promise.all([cached(load), cached(load)])).toEqual([1, 1]);
    expect(loads).toBe(1);
  });

  it("não guarda falha", async () => {
    const cached = ttlCache<number>(10_000, () => 0);
    await expect(cached(async () => Promise.reject(new Error("rpc")))).rejects.toThrow("rpc");
    expect(await cached(async () => 7)).toBe(7);
  });
});
