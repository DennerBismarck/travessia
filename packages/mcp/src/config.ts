import { SANDBOX_API_URL } from "@travessia/hodle/client";

export interface McpConfig {
  apiKey: string;
  apiUrl: string;
  allowWrites: boolean;
  walletPin: string | null;
  protectedSymmetricKey: string | null;
  isSandbox: boolean;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadMcpConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const apiKey = env.HODLE_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      "HODLE_API_KEY não definida. Crie uma chave hodle_test_ em app-sandbox.hodle.com.br e passe pelo ambiente do servidor MCP, nunca como argumento de ferramenta.",
    );
  }
  const apiUrl = (env.HODLE_API_URL?.trim() || SANDBOX_API_URL).replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(apiUrl).host;
  } catch {
    throw new ConfigError(`HODLE_API_URL inválida: ${apiUrl}`);
  }
  return {
    apiKey,
    apiUrl,
    allowWrites: env.HODLE_MCP_ALLOW_WRITES === "true",
    walletPin: env.HODLE_WALLET_PIN?.trim() || null,
    protectedSymmetricKey: env.HODLE_PROTECTED_SYMMETRIC_KEY?.trim() || null,
    isSandbox: host === new URL(SANDBOX_API_URL).host,
  };
}
