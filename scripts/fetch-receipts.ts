// Baixa os recibos das sondagens de 2026-10-15 (dados públicos da Base Sepolia) para fixtures de teste.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RECEIPTS = {
  "deposit-mint": "0xd995a51e94b1a952e040c29269e8a4f22c888574f2c0dbba4fba708ee5373dd9",
  "swap-debit": "0x08c51aedd56d7a000393998786201bf215ccf6f0f3bda548ad18e207aaa867d0",
  "swap-credit": "0xf6efe63cc225276cf38d66ed3e74929743ca1b3b8c6e2aef05fe168065c5b5c3",
  "payout-debit": "0xffc5fab1fa2433f93d4e89fdecc420f83d4c403080b00ab9636cc0edb24560c4",
} as const;

interface RpcReceipt {
  status: string;
  logs: { address: string; topics: string[]; data: string }[];
}

const out = join(import.meta.dirname, "../packages/hodle/src/chain/__fixtures__");
mkdirSync(out, { recursive: true });

for (const [label, hash] of Object.entries(RECEIPTS)) {
  const response = await fetch("https://sepolia.base.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
  });
  const { result } = (await response.json()) as { result: RpcReceipt | null };
  if (!result) throw new Error(`recibo não encontrado: ${hash}`);
  const fixture = {
    hash,
    status: result.status === "0x1" ? "success" : "reverted",
    logs: result.logs.map(({ address, topics, data }) => ({ address, topics, data })),
  };
  writeFileSync(join(out, `${label}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${label}: ${fixture.status}, ${fixture.logs.length} log(s)`);
}
