"use client";

import * as React from "react";
import { BrowserProvider } from "ethers";

import {
  ApiRequestError,
  getMe,
  requestChallenge,
  signOut as apiSignOut,
  verifySignature,
  type Me,
} from "@/lib/api";
import {
  CHAIN,
  type DiscoveredWallet,
  type Eip1193Provider,
  isUserRejection,
  legacyWallet,
  subscribeToWallets,
  switchChain,
  walletErrorMessage,
} from "@/lib/wallet";

/**
 * Turn a failure into something the user can act on.
 *
 * The API returns a deliberately generic "Something went wrong" for unexpected
 * server errors, which is right for security but useless in an interface. In this
 * app a 5xx during sign-in almost always means the server could not reach the
 * chain or the database, so the message says so and names the likely fix rather
 * than repeating the server's shrug.
 */
function describeSignInError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "NOT_CONFIGURED") {
      return "The server is missing configuration. Check apps/platform/.env.local.";
    }
    if (error.status >= 500) {
      return `The server could not reach ${CHAIN.name} or the database. If you are running locally, start the chain with "npm run dev:chain".`;
    }
    if (error.status === 401) {
      return "That signature was rejected. Try signing in again.";
    }
    return error.message;
  }
  return walletErrorMessage(error);
}

/**
 * Wallet connection and session state.
 *
 * Wallets are discovered through EIP-6963 rather than read off
 * `window.ethereum`, because that property holds only one provider and installed
 * wallets overwrite each other on it. Discovery means the user picks which wallet
 * to use instead of getting whichever one injected last.
 *
 * Sign-in is four steps and each is exposed, because three of them fail for
 * different reasons and a single spinner would leave the user guessing which:
 *
 *   connect    ask the chosen wallet for an account
 *   challenge  ask the server for a single-use message
 *   sign       ask the wallet to sign it
 *   verify     hand the signature back for the server to check
 *
 * The session is an httpOnly cookie owned by the server. Nothing here stores a
 * token, and roles are never cached: `Me` is re-read from the API, which re-reads
 * them from the chain.
 */
export type SignInStage =
  | "idle"
  | "connect"
  | "challenge"
  | "sign"
  | "verify"
  | "done"
  | "error";

interface WalletState {
  address: string | null;
  chainId: number | null;
  /** True once the initial session and wallet checks have finished. */
  ready: boolean;
  session: Me | null;
  /**
   * Why the session could not be read, when that is the reason `session` is
   * null. A 401 is the ordinary signed-out state and leaves this null; anything
   * else means the server could not answer, which is a different problem with a
   * different fix and must not be shown as "please sign in".
   */
  sessionError: unknown;
  stage: SignInStage;
  error: string | null;
  /** Every wallet the browser announced, plus a legacy fallback if needed. */
  wallets: DiscoveredWallet[];
  /** The wallet currently in use, once one has been chosen. */
  active: DiscoveredWallet | null;
  wrongChain: boolean;
  signIn: (wallet: DiscoveredWallet) => Promise<void>;
  signOut: () => Promise<void>;
  fixChain: () => Promise<void>;
  refresh: (orgId?: number) => Promise<void>;
  dismissError: () => void;
}

const WalletContext = React.createContext<WalletState | null>(null);

function normaliseAccounts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseChainId(value: unknown): number | null {
  return typeof value === "string" ? Number.parseInt(value, 16) : null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = React.useState<string | null>(null);
  const [chainId, setChainId] = React.useState<number | null>(null);
  const [session, setSession] = React.useState<Me | null>(null);
  const [sessionError, setSessionError] = React.useState<unknown>(null);
  const [ready, setReady] = React.useState(false);
  const [stage, setStage] = React.useState<SignInStage>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [wallets, setWallets] = React.useState<DiscoveredWallet[]>([]);
  const [active, setActive] = React.useState<DiscoveredWallet | null>(null);

  /* Discovery. Announcements can arrive at any time, so this listener stays
     attached for the life of the page rather than resolving once. */
  React.useEffect(() => {
    const unsubscribe = subscribeToWallets((found) => {
      setWallets(found.length > 0 ? found : ([legacyWallet()].filter(Boolean) as DiscoveredWallet[]));
    });

    // Nothing announced means either no wallet, or one too old to announce.
    const settle = window.setTimeout(() => {
      setWallets((current) => {
        if (current.length > 0) return current;
        const legacy = legacyWallet();
        return legacy ? [legacy] : [];
      });
      setReady(true);
    }, 350);

    return () => {
      unsubscribe();
      window.clearTimeout(settle);
    };
  }, []);

  /* Existing session from a previous visit. */
  React.useEffect(() => {
    let cancelled = false;
    void getMe().then(
      (me) => {
        if (cancelled) return;
        setSession(me);
        setSessionError(null);
      },
      (caught: unknown) => {
        // Not a 401 — `getMe` returns null for that. The server could not answer,
        // which usually means it could not reach the chain or the database.
        if (!cancelled) setSessionError(caught);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Silent reconnection.
   *
   * The session lives in a cookie, but `address` and `chainId` are React state
   * and do not survive a page load. Without this, every navigation left the
   * console signed in with no idea which chain the wallet was on: the network
   * chip read "No network" and the wrong-network banner could not fire at all,
   * which is worse than useless — it is a broken safety check.
   *
   * `eth_accounts` is the read that does not prompt. It returns nothing unless
   * the wallet has already authorised this origin, so this cannot pop a dialog
   * at somebody who never connected.
   */
  React.useEffect(() => {
    if (wallets.length === 0 || active) return;
    let cancelled = false;

    void (async () => {
      for (const wallet of wallets) {
        const accounts = normaliseAccounts(
          await wallet.provider.request({ method: "eth_accounts" }).catch(() => null),
        );
        if (accounts.length === 0) continue;

        const chain = parseChainId(
          await wallet.provider.request({ method: "eth_chainId" }).catch(() => null),
        );
        if (cancelled) return;

        setActive(wallet);
        setAddress(accounts[0]);
        setChainId(chain);
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallets, active]);

  /* Events from the wallet in use. Re-subscribed when the active wallet changes,
     so events from a wallet the user switched away from are ignored. */
  React.useEffect(() => {
    const provider = active?.provider;
    if (!provider?.on) return;

    const onAccounts = (...args: unknown[]) => {
      const accounts = normaliseAccounts(args[0]);
      setAddress(accounts[0] ?? null);
      // A different account means the cookie no longer matches the wallet.
      void getMe()
        .then(setSession)
        .catch(() => setSession(null));
    };

    const onChain = (...args: unknown[]) => setChainId(parseChainId(args[0]));

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [active]);

  const readChain = React.useCallback(async (provider: Eip1193Provider) => {
    const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
    setChainId(parseChainId(current));
  }, []);

  const signIn = React.useCallback(
    async (wallet: DiscoveredWallet) => {
      setError(null);
      setActive(wallet);
      const injected = wallet.provider;

      try {
        // 1. Account.
        setStage("connect");
        const accounts = normaliseAccounts(
          await injected.request({ method: "eth_requestAccounts" }),
        );
        const account = accounts[0];
        if (!account) throw new Error("Wallet returned no accounts");
        setAddress(account);
        await readChain(injected);

        // 2. Challenge. The server decides what gets signed, so the client cannot
        //    be talked into signing something of its own construction.
        setStage("challenge");
        const challenge = await requestChallenge(account);

        // 3. Signature. A plain message signature: no gas, no transaction.
        setStage("sign");
        const provider = new BrowserProvider(injected);
        const signer = await provider.getSigner();
        const signature = await signer.signMessage(challenge.message);

        // 4. Verification. The cookie is set here, by the server.
        setStage("verify");
        await verifySignature(challenge.message, signature);

        setSession(await getMe());
        setSessionError(null);
        setStage("done");

        // 5. If the URL carries a returnTo (set by /authorize when no session exists),
        //    redirect there so the SSO flow resumes with full context. Only relative
        //    paths are allowed to prevent open-redirect.
        const returnTo = new URLSearchParams(window.location.search).get("returnTo");
        if (returnTo && returnTo.startsWith("/")) {
          window.location.href = returnTo;
        }
      } catch (caught) {
        setError(describeSignInError(caught));
        setStage(isUserRejection(caught) ? "idle" : "error");
      }
    },
    [readChain],
  );

  const signOut = React.useCallback(async () => {
    await apiSignOut().catch(() => null);
    setSession(null);
    setSessionError(null);
    setStage("idle");
    setError(null);
  }, []);

  const fixChain = React.useCallback(async () => {
    try {
      await switchChain(CHAIN.id, CHAIN.name, active?.provider ?? null);
      if (active) await readChain(active.provider);
    } catch (caught) {
      setError(walletErrorMessage(caught));
    }
  }, [active, readChain]);

  const refresh = React.useCallback(async (orgId?: number) => {
    try {
      setSession(await getMe(orgId));
      setSessionError(null);
    } catch (caught) {
      setSessionError(caught);
      setSession(null);
    }
  }, []);

  const dismissError = React.useCallback(() => {
    setError(null);
    setStage("idle");
  }, []);

  const value: WalletState = {
    address,
    chainId,
    ready,
    session,
    sessionError,
    stage,
    error,
    wallets,
    active,
    // Only meaningful once a chain is known; an absent wallet is not "wrong".
    wrongChain: chainId !== null && chainId !== CHAIN.id,
    signIn,
    signOut,
    fixChain,
    refresh,
    dismissError,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const context = React.useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>");
  return context;
}
