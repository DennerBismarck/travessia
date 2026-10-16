// Ciclo real no sandbox conferindo cada resposta contra o que a Travessia espera e contra a blockchain.
// Uso: pnpm contract (lê .env.sandbox). Relatório em research/, que fica fora do git.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createChainReader, verifyTransfer, ZERO_ADDRESS } from "@travessia/hodle/chain";
import { createHodleClient, SANDBOX_API_URL } from "@travessia/hodle/client";
import { brlCentsToTokenRaw, parseDecimal } from "@travessia/hodle/money";

interface Check {
  item: string;
  expected: string;
  observed: string;
  ok: boolean;
}

const checks: Check[] = [];
function check(item: string, expected: string, observed: unknown, ok: boolean): void {
  checks.push({ item, expected, observed: typeof observed === "string" ? observed : JSON.stringify(observed), ok });
  console.log(`${ok ? "OK      " : "DIVERGE "} ${item}`);
}

const apiKey = process.env.HODLE_API_KEY;
if (!apiKey?.startsWith("hodle_test_")) {
  console.error("Defina HODLE_API_KEY (hodle_test_) em .env.sandbox");
  process.exit(1);
}
const baseUrl = process.env.HODLE_API_URL ?? SANDBOX_API_URL;
const client = createHodleClient({ apiKey, baseUrl });
const chain = createChainReader();
const id = `ctr${Date.now().toString(36)}`;

// 1. Depósito R$ 5,40 em BRLH
const deposit = await client.createDeposit({ valueCents: 540n, asset: "BRLH", externalId: `${id}-dep` });
check("deposit: sandbox.payable", "false", deposit.data.sandbox?.payable, deposit.data.sandbox?.payable === false);

const settle = await client.settleSandboxDeposit(deposit.data.trackId);
check("settle: settled", "true", settle.data.settled, settle.data.settled === true);

const confirmed = await client.getDeposit(deposit.data.trackId);
check("deposit: COMPLETED logo após o settle", "COMPLETED", confirmed.data.status, confirmed.data.status === "COMPLETED");
const wallet = deposit.data.address;
if (confirmed.data.transactionHash) {
  const v = await verifyTransfer(chain.fetchReceipt, confirmed.data.transactionHash as `0x${string}`, {
    token: "BRLH",
    from: ZERO_ADDRESS,
    to: wallet,
    raw: brlCentsToTokenRaw(540n, "BRLH"),
  });
  check("deposit: mint on-chain", "5.4 BRLH de 0x0 para a carteira", v.result, v.result === "confere");
}

// 2. Troca 5.4 BRLH → 1 USDH
const swapKey = `${id}-swap`;
const swap = await client.swap({ fromAsset: "BRLH", toAsset: "USDH", amount: "5.4", clientRequestId: swapKey });
check("swap: COMPLETED", "COMPLETED", swap.data.status, swap.data.status === "COMPLETED");
const sandboxSwap = swap.data.sandbox;
check("swap: amountOut", "1", sandboxSwap?.amountOut, sandboxSwap?.amountOut === "1");
if (sandboxSwap?.debitTxHash && sandboxSwap.creditTxHash) {
  const [debit, credit] = await Promise.all([
    verifyTransfer(chain.fetchReceipt, sandboxSwap.debitTxHash as `0x${string}`, { token: "BRLH", from: wallet, raw: parseDecimal(sandboxSwap.amountIn, 18) }),
    verifyTransfer(chain.fetchReceipt, sandboxSwap.creditTxHash as `0x${string}`, { token: "USDH", from: ZERO_ADDRESS, to: wallet, raw: parseDecimal(sandboxSwap.amountOut, 6) }),
  ]);
  check("swap: débito on-chain", "5.4 BRLH saindo da carteira", debit.result, debit.result === "confere");
  check("swap: crédito on-chain", "1 USDH de 0x0 para a carteira", credit.result, credit.result === "confere");
}
const swapAgain = await client.swap({ fromAsset: "BRLH", toAsset: "USDH", amount: "5.4", clientRequestId: swapKey });
check(
  "swap: repetir clientRequestId devolve a mesma troca",
  "mesmo swapId e mesmos hashes",
  swapAgain.data.swapId,
  swapAgain.data.swapId === swap.data.swapId && swapAgain.data.sandbox?.debitTxHash === sandboxSwap?.debitTxHash,
);

// 3. Saque R$ 2,70 em USDH
const payoutInput = {
  valueCents: 270n,
  asset: "USDH",
  network: "base",
  pixKey: "recebedor@example.com",
  pixKeyType: "EMAIL" as const,
  externalId: `${id}-pay`,
};
const payout = await client.createPayout(payoutInput);
check("payout: 202 COMPLETED", "202 e COMPLETED na resposta", `${payout.httpStatus} ${payout.data.status}`, payout.httpStatus === 202 && payout.data.status === "COMPLETED");
check("payout: stableAmount", "0.5", payout.data.stableAmount, payout.data.stableAmount === "0.5");
if (payout.data.txHash && payout.data.stableAmount) {
  const v = await verifyTransfer(chain.fetchReceipt, payout.data.txHash as `0x${string}`, { token: "USDH", from: wallet, raw: parseDecimal(payout.data.stableAmount, 6) });
  check("payout: débito on-chain", "0.5 USDH saindo da carteira", v.result, v.result === "confere");
}
const payoutAgain = await client.createPayout(payoutInput);
check("payout: repetir externalId devolve o mesmo pagamento", "mesmo transactionId", payoutAgain.data.transactionId, payoutAgain.data.transactionId === payout.data.transactionId);

// Relatório
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const dir = join(import.meta.dirname, "../research");
mkdirSync(dir, { recursive: true });
const file = join(dir, `contrato-${stamp}.md`);
writeFileSync(
  file,
  [
    `# Contrato da API no sandbox — ${new Date().toISOString()}`,
    "",
    `Execução ${id}. Carteira ${wallet}.`,
    "",
    "| Item | Esperado | Observado | Resultado |",
    "| --- | --- | --- | --- |",
    ...checks.map((c) => `| ${c.item} | ${c.expected} | ${c.observed.replaceAll("|", "\\|")} | ${c.ok ? "OK" : "DIVERGE"} |`),
    "",
  ].join("\n"),
);
console.log(`\n${checks.filter((c) => !c.ok).length} divergência(s). Relatório: ${file}`);
