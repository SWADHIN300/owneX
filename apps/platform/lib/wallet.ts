/**
 * Browser wallet helpers.
 *
 * Deliberately thin: no wallet-connect SDK, no chain abstraction library. The app
 * needs an EIP-1193 provider, one signature and a chain id, and ethers already
 * does all three. A connector library would add hundreds of kilobytes to solve a
 * problem this app does not have yet.
 */

/** Minimal EIP-1193 surface, which is all an injected wallet needs to expose. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const CHAIN = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
  name: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Hardhat Local",
  explorer: process.env.NEXT_PUBLIC_EXPLORER_URL ?? null,
} as const;

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

/** Hex chain id as a wallet expects it: 31337 becomes 0x7a69. */
export function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

/**
 * Errors from an injected wallet carry a numeric `code`. These are the two worth
 * branching on rather than surfacing as a raw message.
 */
export const WALLET_ERROR = {
  /** The prompt was dismissed or rejected. Not a failure worth shouting about. */
  USER_REJECTED: 4001,
  /** The chain is not in the wallet yet, so it has to be added before switching. */
  UNRECOGNISED_CHAIN: 4902,
} as const;

export function walletErrorCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return null;
}

export function isUserRejection(error: unknown): boolean {
  return walletErrorCode(error) === WALLET_ERROR.USER_REJECTED;
}

/** Readable reason, without leaking a stack trace into the interface. */
export function walletErrorMessage(error: unknown): string {
  if (isUserRejection(error)) return "Request was rejected in the wallet.";
  if (error instanceof Error && error.message) {
    return error.message.split("\n")[0].slice(0, 160);
  }
  return "The wallet could not complete the request.";
}

/**
 * Switch networks, adding the chain first if the wallet does not know it. A local
 * development chain is never present by default, which is the common case here.
 */
export async function switchChain(chainId: number, chainName: string): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet found");

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHexChainId(chainId) }],
    });
  } catch (error) {
    if (walletErrorCode(error) !== WALLET_ERROR.UNRECOGNISED_CHAIN) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: toHexChainId(chainId),
          chainName,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [chainId === 31337 ? "http://127.0.0.1:8545" : ""],
        },
      ],
    });
  }
}

/** Truncate an address the way wallets do, keeping both ends readable. */
export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}
