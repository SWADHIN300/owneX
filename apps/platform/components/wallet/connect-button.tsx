"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";
import { type DiscoveredWallet, shortAddress } from "@/lib/wallet";
import { Identicon } from "@/components/ui";

import { useWallet, type SignInStage } from "./wallet-provider";
import { WalletList } from "./wallet-list";

/** What each stage waits on, in the user's terms rather than the protocol's. */
const STAGE_LABEL = {
  connect: "Waiting for your wallet",
  challenge: "Requesting a challenge",
  sign: "Sign the message in your wallet",
  verify: "Verifying your signature",
} as const;

const STAGE_ORDER = ["connect", "challenge", "sign", "verify"] as const;

/**
 * Sign-in control.
 *
 * Everything it opens is an absolutely positioned popover anchored to the button.
 * Rendering the status inline made the header grow and pushed the button off the
 * side of the screen, so the panel is taken out of flow and pinned to the button's
 * end edge instead.
 *
 * Signing in costs no gas and sends no transaction, which is worth saying out
 * loud: people have learned to expect a fee prompt whenever a wallet opens.
 */
export function ConnectButton({ className }: { className?: string }) {
  const {
    session,
    stage,
    error,
    ready,
    wallets,
    signIn,
    signOut,
    dismissError,
  } = useWallet();
  const reduceMotion = useReducedMotion();
  const [picking, setPicking] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const busy = stage !== "idle" && stage !== "done" && stage !== "error";
  const open = picking || busy || Boolean(error);

  // Any open panel closes on Escape or on a click outside it.
  React.useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPicking(false);
      if (error) dismissError();
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setPicking(false);
      if (error) dismissError();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, error, dismissError]);

  const onPrimary = () => {
    if (error) dismissError();
    if (wallets.length === 0) return;
    // One wallet needs no choice; several do.
    if (wallets.length === 1) {
      setPicking(false);
      void signIn(wallets[0]);
    } else {
      setPicking((value) => !value);
    }
  };

  /** Choosing a wallet closes the picker and starts the flow in one step. */
  const onPick = (wallet: DiscoveredWallet) => {
    setPicking(false);
    void signIn(wallet);
  };

  if (session) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 ps-1 pe-3">
          <Identicon value={session.wallet} size={26} />
          <span className="font-mono text-xs text-ink">
            {session.profile?.displayName ?? shortAddress(session.wallet)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-full border border-border px-4 py-2.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-brand-soft"
        >
          Sign out
        </button>
      </div>
    );
  }

  const noWallet = ready && wallets.length === 0;

  return (
    /* Network state is deliberately not shown here. The header carries a
       NetworkChip and the console carries a full banner, so repeating it inside
       this control produced two "Wrong network" pills side by side. */
    <div ref={rootRef} className={cn("relative flex items-center gap-2", className)}>
      {noWallet ? (
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noreferrer noopener"
          className={PRIMARY_CLASS}
        >
          Install a wallet
        </a>
      ) : (
        <button
          type="button"
          onClick={onPrimary}
          disabled={busy || !ready}
          aria-busy={busy}
          aria-haspopup={wallets.length > 1 ? "dialog" : undefined}
          aria-expanded={wallets.length > 1 ? picking : undefined}
          className={PRIMARY_CLASS}
        >
          {busy ? <Spinner /> : null}
          {busy ? "Signing in" : "Connect wallet"}
        </button>
      )}

      {/* Out of flow, pinned to the button, so the header cannot be stretched. */}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            className="absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-3 shadow-lifted"
            role={picking ? "dialog" : "status"}
            aria-label={picking ? "Choose a wallet" : undefined}
            aria-live={picking ? undefined : "polite"}
          >
            {error ? (
              <ErrorPanel message={error} onDismiss={dismissError} />
            ) : busy ? (
              <SigningRail stage={stage} />
            ) : (
              <WalletList wallets={wallets} onPick={onPick} />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const PRIMARY_CLASS = cn(
  "inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-5 py-2.5",
  "font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand-ink",
  "transition-colors duration-200 hover:bg-brand-hover",
  "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-brand",
);

/** The four steps, so a stall is attributable to a specific one. */
function SigningRail({ stage }: { stage: SignInStage }) {
  const activeIndex = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);

  return (
    <div>
      <p className="label-xs mb-2.5 text-ink-faint">Signing in</p>
      <ol className="flex flex-col gap-1.5">
        {STAGE_ORDER.map((key, index) => {
          const done = index < activeIndex;
          const current = index === activeIndex;
          return (
            <li key={key} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  done && "bg-success",
                  current && "bg-brand motion-safe:animate-pulse",
                  !done && !current && "bg-border",
                )}
              />
              <span
                className={cn(
                  "text-xs",
                  current ? "text-ink" : done ? "text-ink-muted" : "text-ink-faint",
                )}
              >
                {STAGE_LABEL[key]}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2.5 border-t border-border-soft pt-2 text-[0.625rem] text-ink-faint">
        No gas, no transaction. This is a signature only.
      </p>
    </div>
  );
}

function ErrorPanel({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div role="alert">
      <p className="label-xs mb-2 text-danger">Could not sign in</p>
      <p className="text-xs leading-relaxed text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 rounded-md border border-border px-3 py-1.5 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-ink transition-colors duration-150 hover:bg-brand-soft"
      >
        Dismiss
      </button>
    </div>
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
