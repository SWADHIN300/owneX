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

/* -------------------------------------------------------------------------- */
/* Wallet discovery (EIP-6963)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `window.ethereum` only ever holds one provider, so when a user has several
 * wallets installed they fight over it and whichever injected last wins. EIP-6963
 * fixes that: the page announces a request and every wallet replies with its own
 * identity and provider, which is how a picker can list all of them.
 */
export interface WalletInfo {
  uuid: string;
  name: string;
  /** Data URI supplied by the wallet. */
  icon: string;
  /** Reverse DNS id, for example io.metamask. Stable across versions. */
  rdns: string;
}

export interface DiscoveredWallet {
  info: WalletInfo;
  provider: Eip1193Provider;
}

interface AnnounceEvent extends CustomEvent {
  detail: DiscoveredWallet;
}

/**
 * Subscribe to wallet announcements. Returns an unsubscribe function.
 *
 * Wallets announce in response to our request, but some announce eagerly on page
 * load too, so the listener is attached before requesting. Duplicates are keyed by
 * rdns rather than uuid, because a wallet that announces twice generates a fresh
 * uuid each time and would otherwise appear twice in the list.
 */
export function subscribeToWallets(
  onChange: (wallets: DiscoveredWallet[]) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const byRdns = new Map<string, DiscoveredWallet>();

  const onAnnounce = (event: Event) => {
    const detail = (event as AnnounceEvent).detail;
    if (!detail?.info?.rdns || !detail.provider) return;
    byRdns.set(detail.info.rdns, detail);
    onChange([...byRdns.values()]);
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
}

/**
 * Fallback entry for a wallet that predates EIP-6963 and only injects
 * `window.ethereum`. Without this, an older wallet would be invisible to a picker
 * built on discovery alone.
 */
export function legacyWallet(): DiscoveredWallet | null {
  const provider = getInjectedProvider();
  if (!provider) return null;
  return {
    info: {
      uuid: "legacy-injected",
      name: "Browser wallet",
      icon: "",
      rdns: "legacy.injected",
    },
    provider,
  };
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
 *
 * Takes the provider explicitly, because with several wallets installed the one
 * the user picked is not necessarily the one on `window.ethereum`.
 */
export async function switchChain(
  chainId: number,
  chainName: string,
  target?: Eip1193Provider | null,
): Promise<void> {
  const provider = target ?? getInjectedProvider();
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
