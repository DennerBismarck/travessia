import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHodleClient } from "@travessia/hodle/client";
import { ConfigError, loadMcpConfig, type McpConfig } from "./config";
import { createMcpServer } from "./server";

let config: McpConfig;
try {
  config = loadMcpConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const client = createHodleClient({ apiKey: config.apiKey, baseUrl: config.apiUrl });
await createMcpServer(config, client).connect(new StdioServerTransport());
// stdout é o protocolo: mensagens humanas vão para o stderr.
console.error(`travessia-hodle-mcp: ${config.isSandbox ? "sandbox" : "PRODUÇÃO"}, escrita ${config.allowWrites ? "ligada" : "desligada"}`);
