"use client";

import * as React from "react";
import { BrowserProvider } from "ethers";

import {
  getMe,
  requestChallenge,
  signOut as apiSignOut,
  verifySignature,
  type Me,
} from "@/lib/api";
import {
  CHAIN,
  getInjectedProvider,
  isUserRejection,
  switchChain,
  walletErrorMessage,
} from "@/lib/wallet";

/**
 * Wallet connection and session state.
 *
 * Sign-in is four steps and each one is exposed, because three of them can fail
 * for different reasons and a single spinner would leave the user guessing which:
 *
 *   connect    ask the wallet for an account
 *   challenge  ask the server for a single-use message
 *   sign       ask the wallet to sign it
 *   verify     hand the signature back for the server to check
 *
 * The session itself is an httpOnly cookie owned by the server. Nothing here
 * stores a token, and roles are never cached: `Me` is re-read from the API, which
 * re-reads them from the chain.
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
  /** Connected account, or null when the wallet is locked or absent. */
  address: string | null;
  chainId: number | null;
  /** True once the initial session check has finished. */
  ready: boolean;
  session: Me | null;
  stage: SignInStage;
  error: string | null;
  hasWallet: boolean;
  wrongChain: boolean;
  connect: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  fixChain: () => Promise<void>;
  refresh: (orgId?: number) => Promise<void>;
}

const WalletContext = React.createContext<WalletState | null>(null);

function normaliseAccounts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = React.useState<string | null>(null);
  const [chainId, setChainId] = React.useState<number | null>(null);
  const [session, setSession] = React.useState<Me | null>(null);
  const [ready, setReady] = React.useState(false);
  const [stage, setStage] = React.useState<SignInStage>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [hasWallet, setHasWallet] = React.useState(false);

  /* Initial state: is a wallet present, is one already connected, and is there
     already a valid session cookie from a previous visit. */
  React.useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const provider = getInjectedProvider();
      if (provider) {
        if (!cancelled) setHasWallet(true);
        try {
          // eth_accounts does not prompt; it only reports existing permission.
          const accounts = normaliseAccounts(await provider.request({ method: "eth_accounts" }));
          const currentChain = await provider.request({ method: "eth_chainId" });
          if (!cancelled) {
            setAddress(accounts[0] ?? null);
            setChainId(typeof currentChain === "string" ? Number.parseInt(currentChain, 16) : null);
          }
        } catch {
          // A locked or hostile provider is treated as simply not connected.
        }
      }

      const me = await getMe().catch(() => null);
      if (!cancelled) {
        setSession(me);
        setReady(true);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Wallet events. An account or chain change invalidates what is on screen, so
     the session is re-read rather than assumed to still apply. */
  React.useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider?.on) return;

    const onAccounts = (...args: unknown[]) => {
      const accounts = normaliseAccounts(args[0]);
      setAddress(accounts[0] ?? null);
      // A different account means the cookie no longer matches the wallet.
      void getMe()
        .then(setSession)
        .catch(() => setSession(null));
    };

    const onChain = (...args: unknown[]) => {
      const next = args[0];
      setChainId(typeof next === "string" ? Number.parseInt(next, 16) : null);
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = React.useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      setError("No browser wallet found. Install MetaMask to continue.");
      setStage("error");
      return;
    }

    setError(null);
    setStage("connect");
    try {
      const accounts = normaliseAccounts(
        await provider.request({ method: "eth_requestAccounts" }),
      );
      if (accounts.length === 0) throw new Error("Wallet returned no accounts");
      setAddress(accounts[0]);

      const currentChain = await provider.request({ method: "eth_chainId" });
      setChainId(typeof currentChain === "string" ? Number.parseInt(currentChain, 16) : null);
      setStage("idle");
    } catch (caught) {
      setError(walletErrorMessage(caught));
      setStage(isUserRejection(caught) ? "idle" : "error");
    }
  }, []);

  const signIn = React.useCallback(async () => {
    const injected = getInjectedProvider();
    if (!injected) {
      setError("No browser wallet found. Install MetaMask to continue.");
      setStage("error");
      return;
    }

    setError(null);
    try {
      // 1. Account.
      setStage("connect");
      const accounts = normaliseAccounts(
        await injected.request({ method: "eth_requestAccounts" }),
      );
      const wallet = accounts[0];
      if (!wallet) throw new Error("Wallet returned no accounts");
      setAddress(wallet);

      // 2. Challenge. The server decides what gets signed, so the client cannot
      //    be tricked into signing something of its own construction.
      setStage("challenge");
      const challenge = await requestChallenge(wallet);

      // 3. Signature. This is a plain message signature: no gas, no transaction.
      setStage("sign");
      const provider = new BrowserProvider(injected);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(challenge.message);

      // 4. Verification. The cookie is set here, by the server.
      setStage("verify");
      await verifySignature(challenge.message, signature);

      const me = await getMe();
      setSession(me);
      setStage("done");
    } catch (caught) {
      setError(walletErrorMessage(caught));
      setStage(isUserRejection(caught) ? "idle" : "error");
    }
  }, []);

  const signOut = React.useCallback(async () => {
    await apiSignOut().catch(() => null);
    setSession(null);
    setStage("idle");
    setError(null);
  }, []);

  const fixChain = React.useCallback(async () => {
    try {
      await switchChain(CHAIN.id, CHAIN.name);
    } catch (caught) {
      setError(walletErrorMessage(caught));
    }
  }, []);

  const refresh = React.useCallback(async (orgId?: number) => {
    const me = await getMe(orgId).catch(() => null);
    setSession(me);
  }, []);

  const value: WalletState = {
    address,
    chainId,
    ready,
    session,
    stage,
    error,
    hasWallet,
    // Only meaningful once a chain is known; an absent wallet is not "wrong".
    wrongChain: chainId !== null && chainId !== CHAIN.id,
    connect,
    signIn,
    signOut,
    fixChain,
    refresh,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const context = React.useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>");
  return context;
}
