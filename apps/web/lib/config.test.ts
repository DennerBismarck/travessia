import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const KEY = "hodle_test_UNITTESTKEY1234567890";

describe("loadConfig", () => {
  it("aplica os padrões da spec", () => {
    expect(loadConfig({ HODLE_API_KEY: KEY })).toEqual({
      apiKey: KEY,
      apiUrl: "https://sandbox-api.hodle.com.br",
      pixKeyDemo: "recebedor@example.com",
      dailyRunCap: 200,
      killSwitch: false,
      rpcUrls: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
      databasePath: "/data/travessia.sqlite",
      publicBaseUrl: "http://localhost:3000",
    });
  });

  it("recusa chave de produção sem ecoar o valor", () => {
    const live = "hodle_live_SHOULDNOTLEAK123456";
    expect(() => loadConfig({ HODLE_API_KEY: live })).toThrow(/use uma chave hodle_test_/);
    try {
      loadConfig({ HODLE_API_KEY: live });
    } catch (error) {
      expect(String(error)).not.toContain(live);
    }
  });

  it("recusa chave ausente", () => {
    expect(() => loadConfig({})).toThrow(/HODLE_API_KEY não definida/);
  });

  it("trata strings vazias como ausentes", () => {
    const config = loadConfig({ HODLE_API_KEY: KEY, DAILY_RUN_CAP: "", KILL_SWITCH: " " });
    expect(config.dailyRunCap).toBe(200);
    expect(config.killSwitch).toBe(false);
  });

  it("lê os valores informados", () => {
    const config = loadConfig({
      HODLE_API_KEY: KEY,
      HODLE_API_URL: "https://sandbox-api.hodle.com.br/",
      DAILY_RUN_CAP: "5",
      KILL_SWITCH: "1",
      BASE_SEPOLIA_RPC_URLS: " https://a.example , https://b.example ,",
      PUBLIC_BASE_URL: "https://travessia.fly.dev/",
    });
    expect(config.apiUrl).toBe("https://sandbox-api.hodle.com.br");
    expect(config.dailyRunCap).toBe(5);
    expect(config.killSwitch).toBe(true);
    expect(config.rpcUrls).toEqual(["https://a.example", "https://b.example"]);
    expect(config.publicBaseUrl).toBe("https://travessia.fly.dev");
  });
});
