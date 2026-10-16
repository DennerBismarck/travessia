import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HodleClient } from "@travessia/hodle/client";
import type { McpConfig } from "./config";
import { buildTools } from "./tools";

export function createMcpServer(config: McpConfig, client: HodleClient): McpServer {
  const server = new McpServer({ name: "travessia-hodle-mcp", version: "0.1.0" });
  for (const tool of buildTools(config, client)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: !tool.write, destructiveHint: tool.write, openWorldHint: true },
      },
      async (args) => {
        const result = await tool.handler(args);
        return { content: [{ type: "text", text: JSON.stringify(result.payload, null, 2) }], isError: result.isError };
      },
    );
  }
  return server;
}
