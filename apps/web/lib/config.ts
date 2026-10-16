import "server-only";
import { z } from "zod";
import { DEFAULT_RPC_URLS } from "@travessia/hodle/chain";
import { SANDBOX_API_URL } from "@travessia/hodle/client";

export interface AppConfig {
  apiKey: string;
  apiUrl: string;
  pixKeyDemo: string;
  dailyRunCap: number;
  killSwitch: boolean;
  rpcUrls: string[];
  databasePath: string;
  publicBaseUrl: string;
}

const EnvSchema = z.object({
  HODLE_API_KEY: z
    .string({ error: "HODLE_API_KEY não definida" })
    .regex(/^hodle_test_/, "a Travessia só roda no sandbox: use uma chave hodle_test_"),
  HODLE_API_URL: z.url().default(SANDBOX_API_URL),
  PIX_KEY_DEMO: z.email().default("recebedor@example.com"),
  DAILY_RUN_CAP: z.coerce.number().int().positive().default(200),
  KILL_SWITCH: z.enum(["true", "false", "1", "0"]).default("false"),
  BASE_SEPOLIA_RPC_URLS: z.string().default(DEFAULT_RPC_URLS.join(",")),
  DATABASE_PATH: z.string().default("/data/travessia.sqlite"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:3000"),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Configuração inválida: ${problems}`);
  }
  const e = parsed.data;
  return {
    apiKey: e.HODLE_API_KEY,
    apiUrl: e.HODLE_API_URL.replace(/\/+$/, ""),
    pixKeyDemo: e.PIX_KEY_DEMO,
    dailyRunCap: e.DAILY_RUN_CAP,
    killSwitch: e.KILL_SWITCH === "true" || e.KILL_SWITCH === "1",
    rpcUrls: e.BASE_SEPOLIA_RPC_URLS.split(",").map((url) => url.trim()).filter(Boolean),
    databasePath: e.DATABASE_PATH,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ""),
  };
}
