// Fecha o ciclo do sandbox só com as ferramentas do MCP, falando stdio como um agente faria.
// Uso: pnpm mcp:smoke (lê .env.sandbox).
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const apiKey = process.env.HODLE_API_KEY ?? "";
if (!apiKey.startsWith("hodle_test_")) {
  console.error("Defina HODLE_API_KEY (hodle_test_) em .env.sandbox");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(import.meta.dirname, "../packages/mcp/bin/travessia-hodle-mcp.mjs")],
  env: {
    ...getDefaultEnvironment(),
    HODLE_API_KEY: apiKey,
    HODLE_API_URL: process.env.HODLE_API_URL ?? "https://sandbox-api.hodle.com.br",
    HODLE_MCP_ALLOW_WRITES: "true",
  },
  stderr: "inherit",
});
const client = new Client({ name: "travessia-smoke", version: "0.1.0" });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
  if (text.includes(apiKey)) throw new Error("a chave apareceu na saída do MCP");
  console.log(`→ ${name}${result.isError ? " (recusado)" : ""}`);
  return JSON.parse(text);
}

const id = `mcp${Date.now().toString(36)}`;
const { tools } = await client.listTools();
console.log(`ferramentas: ${tools.map((t) => t.name).join(", ")}`);

const refused = await call("hodle_deposit_asset", { value: 108, asset: "BRLH", externalId: `${id}-dep` });
if (refused.refused !== true) throw new Error("sem confirm a escrita deveria ser recusada");
console.log(`   ${refused.reason}`);
const deposit = await call("hodle_deposit_asset", { value: 108, asset: "BRLH", externalId: `${id}-dep`, confirm: true });
await call("hodle_sandbox_settle", { trackId: deposit.trackId, confirm: true });
const status = await call("hodle_deposit_status", { id: deposit.trackId });
console.log(`   depósito ${status.data.status}, mint ${status.data.transactionHash}`);
const swap = await call("hodle_wallet_swap", { fromAsset: "BRLH", toAsset: "USDH", amount: "1.08", clientRequestId: `${id}-swap`, confirm: true });
console.log(`   troca ${swap.sandbox.amountIn} BRLH → ${swap.sandbox.amountOut} USDH`);
const payout = await call("hodle_wallet_payout", {
  value: 54,
  asset: "USDH",
  network: "base",
  pixKey: "recebedor@example.com",
  pixKeyType: "EMAIL",
  externalId: `${id}-pay`,
  confirm: true,
});
console.log(`   saque ${payout.status}: ${payout.stableAmount} USDH, endToEndId ${payout.endToEndId}, tx ${payout.txHash}`);
await client.close();
