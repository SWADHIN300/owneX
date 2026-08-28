"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { CHAIN } from "@/lib/wallet";
import { Modal } from "@/components/ui";

import { useWallet } from "./wallet-provider";
import { WalletList } from "./wallet-list";

/**
 * The page's primary call to action.
 *
 * It previously pointed at `#how-it-works`, so clicking it scrolled the page and
 * looked like nothing had happened. Now it does the thing it offers:
 *
 *   already signed in  go to the console
 *   wallet available   run the sign-in flow, picking a wallet when there is more
 *                      than one
 *   no wallet          send them somewhere they can get one
 *
 * Wallet choice opens in a modal rather than a popover, because this button sits
 * mid-page where an anchored panel has no reliable room.
 */
export function GetStartedButton({
  className,
  label = "Get started",
}: {
  className?: string;
  label?: string;
}) {
  const { session, ready, wallets, stage, error, signIn, dismissError } = useWallet();
  const [picking, setPicking] = React.useState(false);

  const busy = stage !== "idle" && stage !== "done" && stage !== "error";

  const base = cn(
    "inline-flex items-center justify-center gap-2 rounded-full bg-brand px-8 py-4",
    "font-mono text-xs font-semibold uppercase tracking-[0.12em] text-brand-ink",
    "transition-colors duration-200 hover:bg-brand-hover",
    "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-brand",
    className,
  );

  if (session) {
    return (
      <Link href="/dashboard" className={base}>
        Open console
      </Link>
    );
  }

  if (ready && wallets.length === 0) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer noopener"
        className={base}
      >
        Install a wallet
      </a>
    );
  }

  const start = () => {
    if (error) dismissError();
    if (wallets.length === 1) void signIn(wallets[0]);
    else setPicking(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={busy || !ready}
        aria-busy={busy}
        className={base}
      >
        {busy ? <Spinner /> : null}
        {busy ? "Signing in" : label}
      </button>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Choose a wallet"
        description={`Signing in costs nothing and sends no transaction. Expecting ${CHAIN.name}.`}
        size="sm"
      >
        <WalletList
          wallets={wallets}
          onPick={(wallet) => {
            setPicking(false);
            void signIn(wallet);
          }}
        />
      </Modal>
    </>
  );
}

function Spinner() {
  return (
    <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
