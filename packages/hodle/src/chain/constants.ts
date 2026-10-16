import type { Token } from "../money";

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const TOKEN_ADDRESSES: Readonly<Record<Token, `0x${string}`>> = {
  BRLH: "0x4ec5f42ee07d5d1cfe431ec7059df4df556d44a8",
  USDH: "0x1c7af3c850c1d1d8d97d40db0acdd0195c6323f7",
};

export const DEFAULT_RPC_URLS: readonly string[] = ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"];

export const explorerTxUrl = (hash: string): string => `https://sepolia.basescan.org/tx/${hash}`;
export const explorerAddressUrl = (address: string): string => `https://sepolia.basescan.org/address/${address}`;
