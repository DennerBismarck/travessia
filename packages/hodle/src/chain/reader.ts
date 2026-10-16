import { createPublicClient, erc20Abi, fallback, http, TransactionReceiptNotFoundError } from "viem";
import { baseSepolia } from "viem/chains";
import type { Token } from "../money";
import { DEFAULT_RPC_URLS, TOKEN_ADDRESSES } from "./constants";
import type { ReceiptFetcher } from "./verify";

export interface ChainReader {
  fetchReceipt: ReceiptFetcher;
  getBalances(address: `0x${string}`): Promise<Record<Token, bigint>>;
  getChainId(): Promise<number>;
}

export function createChainReader(rpcUrls: readonly string[] = DEFAULT_RPC_URLS): ChainReader {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 5_000, retryCount: 0 })), { retryCount: 0 }),
  });

  return {
    async fetchReceipt(hash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        return {
          status: receipt.status,
          logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
        };
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    async getBalances(address) {
      const read = (token: Token) =>
        client.readContract({ address: TOKEN_ADDRESSES[token], abi: erc20Abi, functionName: "balanceOf", args: [address] });
      const [BRLH, USDH] = await Promise.all([read("BRLH"), read("USDH")]);
      return { BRLH, USDH };
    },
    getChainId: () => client.getChainId(),
  };
}
