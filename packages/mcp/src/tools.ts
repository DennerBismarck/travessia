import { HodleError, redact, type HodleClient } from "@travessia/hodle/client";
import { z } from "zod";
import type { McpConfig } from "./config";

export interface ToolResult {
  isError: boolean;
  payload: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  write: boolean;
  inputSchema: Record<string, z.ZodType>;
  handler(args: unknown): Promise<ToolResult>;
}

const OUTCOME_UNKNOWN_HINT =
  "A operação pode já ter sido aceita pela API. Não repita às cegas: confira o estado (hodle_deposit_status para depósitos) e, se for repetir, use o MESMO externalId/clientRequestId, que a API trata como idempotente.";

const confirm = z.boolean().optional().describe("Precisa ser true para executar. Sem ele nada é enviado e a resposta descreve o que seria feito.");
const sandboxAsset = z.enum(["BRLH", "USDH"]);
const idempotencyKey = z.string().min(1).max(100);

export function buildTools(config: McpConfig, client: HodleClient): ToolDef[] {
  const secrets = [config.apiKey, config.walletPin, config.protectedSymmetricKey].filter((s): s is string => Boolean(s));
  const scrub = (value: unknown) => redact(value, secrets);
  const ok = (payload: unknown): ToolResult => ({ isError: false, payload: scrub(payload) });
  const refuse = (reason: string, wouldCall?: { method: string; path: string; body: unknown }): ToolResult => ({
    isError: true,
    payload: scrub({ refused: true, reason, ...(wouldCall ? { wouldCall } : {}) }),
  });
  const run = async (call: () => Promise<{ body: unknown }>): Promise<ToolResult> => {
    try {
      return ok((await call()).body);
    } catch (error) {
      if (!(error instanceof HodleError)) throw error;
      return {
        isError: true,
        payload: scrub({
          status: error.status,
          code: error.code,
          message: error.message,
          outcomeUnknown: error.outcomeUnknown,
          ...(error.outcomeUnknown ? { nextStep: OUTCOME_UNKNOWN_HINT } : {}),
          details: error.details,
        }),
      };
    }
  };
  const missingConfirm = "confirm: true ausente: nada foi enviado.";
  const sandboxOnly = (name: string) => `${name} só existe no sandbox, e HODLE_API_URL aponta para ${config.apiUrl}.`;

  const walletShape = { sync: z.boolean().optional().describe("true força a leitura on-chain") };
  const statusShape = { id: z.string().min(1).describe("trackId ou walletCharge do depósito") };
  const depositShape = {
    value: z.number().int().positive().describe("centavos de BRL, ex.: 108 = R$ 1,08"),
    asset: sandboxAsset,
    externalId: idempotencyKey.describe("chave de idempotência: repetir devolve o mesmo depósito"),
    confirm,
  };
  const settleShape = { trackId: z.string().min(1).describe("trackId devolvido por hodle_deposit_asset"), confirm };
  const swapShape = {
    fromAsset: sandboxAsset,
    toAsset: sandboxAsset,
    amount: z.string().regex(/^\d+(\.\d+)?$/).describe('unidades do token, ex.: "1.08"'),
    clientRequestId: idempotencyKey.describe("chave de idempotência da troca"),
    confirm,
  };
  const payoutShape = {
    value: z.number().int().positive().describe("centavos de BRL a pagar por Pix"),
    asset: z.enum(["BRLH", "USDH", "USDC", "USDT", "BRLA"]),
    network: z.enum(["base", "polygon", "solana"]),
    pixKey: z.string().min(1),
    pixKeyType: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"]),
    externalId: idempotencyKey.describe("chave de idempotência: repetir devolve o mesmo saque"),
    subAccountId: z.string().optional().describe("não suportado: este servidor guarda uma só credencial"),
    confirm,
  };

  const reads: ToolDef[] = [
    {
      name: "hodle_wallet_get",
      description: "Lê endereços e saldos da carteira (GET /api/wallet).",
      write: false,
      inputSchema: walletShape,
      handler: async (raw) => {
        const args = z.object(walletShape).parse(raw ?? {});
        return run(() => client.getWallet({ sync: args.sync === true }));
      },
    },
    {
      name: "hodle_deposit_status",
      description: "Lê o estado de um depósito pelo trackId ou walletCharge (GET /api/deposit/{id}): PENDING, COMPLETED, transactionHash.",
      write: false,
      inputSchema: statusShape,
      handler: async (raw) => {
        const args = z.object(statusShape).parse(raw);
        return run(() => client.getDeposit(args.id));
      },
    },
  ];
  if (!config.allowWrites) return reads;

  const writes: ToolDef[] = [
    {
      name: "hodle_deposit_asset",
      description: "Cria um depósito Pix → BRLH/USDH no sandbox (POST /api/deposit/asset). Exige confirm: true.",
      write: true,
      inputSchema: depositShape,
      handler: async (raw) => {
        const args = z.object(depositShape).parse(raw);
        const body = { value: args.value, asset: args.asset, externalId: args.externalId };
        if (!args.confirm) return refuse(missingConfirm, { method: "POST", path: "/api/deposit/asset", body });
        return run(() => client.createDeposit({ valueCents: BigInt(args.value), asset: args.asset, externalId: args.externalId }));
      },
    },
    {
      name: "hodle_sandbox_settle",
      description: "Simula a chegada do Pix de um depósito do sandbox (POST /avenia/webhook). Só no sandbox. Exige confirm: true.",
      write: true,
      inputSchema: settleShape,
      handler: async (raw) => {
        const args = z.object(settleShape).parse(raw);
        if (!config.isSandbox) return refuse(sandboxOnly("hodle_sandbox_settle"));
        const body = { event: { subscription: "TICKET", data: { type: "DEPOSIT-SUCCESS", ticket: { id: args.trackId } } } };
        if (!args.confirm) return refuse(missingConfirm, { method: "POST", path: "/avenia/webhook", body });
        return run(() => client.settleSandboxDeposit(args.trackId));
      },
    },
    {
      name: "hodle_wallet_swap",
      description: "Troca BRLH ↔ USDH na carteira de teste (POST /api/wallet/swap). Só no sandbox. Exige confirm: true.",
      write: true,
      inputSchema: swapShape,
      handler: async (raw) => {
        const args = z.object(swapShape).parse(raw);
        if (!config.isSandbox) return refuse(sandboxOnly("hodle_wallet_swap"));
        if (args.fromAsset === args.toAsset) return refuse("fromAsset e toAsset precisam ser diferentes.");
        const body = { fromAsset: args.fromAsset, toAsset: args.toAsset, amount: args.amount, clientRequestId: args.clientRequestId };
        if (!args.confirm) return refuse(missingConfirm, { method: "POST", path: "/api/wallet/swap", body });
        return run(() => client.swap(body));
      },
    },
    {
      name: "hodle_wallet_payout",
      description:
        "Paga um Pix a partir da carteira (POST /api/wallet/payout). Recusa subAccountId. Com USDC, USDT ou BRLA exige HODLE_WALLET_PIN e HODLE_PROTECTED_SYMMETRIC_KEY no ambiente. Exige confirm: true.",
      write: true,
      inputSchema: payoutShape,
      handler: async (raw) => {
        const args = z.object(payoutShape).parse(raw);
        if (args.subAccountId) {
          return refuse("subAccountId recusado: um saque de subconta precisa do PIN e da chave daquela subconta, e este servidor guarda uma só credencial.");
        }
        const sandboxAssetUsed = args.asset === "BRLH" || args.asset === "USDH";
        if (!sandboxAssetUsed && (!config.walletPin || !config.protectedSymmetricKey)) {
          return refuse(`Saque com ${args.asset} exige HODLE_WALLET_PIN e HODLE_PROTECTED_SYMMETRIC_KEY no ambiente do servidor. Nunca passe o PIN como argumento.`);
        }
        const body = {
          value: args.value,
          asset: args.asset,
          network: args.network,
          pixKey: args.pixKey,
          pixKeyType: args.pixKeyType,
          externalId: args.externalId,
          ...(config.walletPin ? { walletPin: "(do ambiente)", protectedSymmetricKey: "(do ambiente)" } : {}),
        };
        if (!args.confirm) return refuse(missingConfirm, { method: "POST", path: "/api/wallet/payout", body });
        return run(() =>
          client.createPayout({
            valueCents: BigInt(args.value),
            asset: args.asset,
            network: args.network,
            pixKey: args.pixKey,
            pixKeyType: args.pixKeyType,
            externalId: args.externalId,
            walletPin: config.walletPin ?? undefined,
            protectedSymmetricKey: config.protectedSymmetricKey ?? undefined,
          }),
        );
      },
    },
  ];
  return [...reads, ...writes];
}
