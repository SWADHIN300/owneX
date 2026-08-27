"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";
import { CHAIN, shortAddress } from "@/lib/wallet";
import { Badge, Identicon } from "@/components/ui";

import { useWallet, type SignInStage } from "./wallet-provider";

/** What each stage is waiting on, in the user's terms rather than the protocol's. */
const STAGE_LABEL: Record<Exclude<SignInStage, "idle" | "done" | "error">, string> = {
  connect: "Waiting for your wallet",
  challenge: "Requesting a challenge",
  sign: "Sign the message in your wallet",
  verify: "Verifying your signature",
};

const STAGE_ORDER: Array<keyof typeof STAGE_LABEL> = [
  "connect",
  "challenge",
  "sign",
  "verify",
];

/**
 * Sign-in control.
 *
 * Signing in costs no gas and sends no transaction, which is worth saying out
 * loud: users have learned to expect a fee prompt whenever a wallet opens, and
 * hesitate when they do not know which kind of request this is.
 */
export function ConnectButton({ className }: { className?: string }) {
  const { address, session, stage, error, hasWallet, ready, wrongChain, signIn, signOut, fixChain } =
    useWallet();
  const reduceMotion = useReducedMotion();

  const busy = stage !== "idle" && stage !== "done" && stage !== "error";

  if (session) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {wrongChain ? <WrongChainPill onFix={fixChain} /> : null}
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

  return (
    <div className={cn("flex flex-col items-end gap-2", className)}>
      <div className="flex items-center gap-2">
        {wrongChain ? <WrongChainPill onFix={fixChain} /> : null}

        {/* Detection runs after mount, so until it finishes the button stays
            neutral rather than accusing the visitor of not having a wallet. */}
        {ready && !hasWallet ? (
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5",
              "font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand-ink",
              "transition-colors duration-200 hover:bg-brand-hover",
            )}
          >
            Install a wallet
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void signIn()}
            disabled={busy || !ready}
            aria-busy={busy}
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5",
              "font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand-ink",
              "transition-colors duration-200 hover:bg-brand-hover",
              "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-brand",
            )}
          >
            {busy ? <Spinner /> : null}
            {busy ? "Signing in" : address ? "Sign in" : "Connect wallet"}
          </button>
        )}
      </div>

      <AnimatePresence>
        {busy || error ? (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="w-full max-w-xs rounded-lg border border-border bg-surface p-3 shadow-card"
            role="status"
            aria-live="polite"
          >
            {error ? (
              <p className="text-xs leading-relaxed text-danger">{error}</p>
            ) : (
              <SigningRail stage={stage} />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The four steps, so a stall is attributable to a specific one. */
function SigningRail({ stage }: { stage: SignInStage }) {
  const activeIndex = STAGE_ORDER.indexOf(stage as keyof typeof STAGE_LABEL);

  return (
    <div>
      <p className="label-xs mb-2.5 text-ink-faint">Signing in</p>
      <ol className="flex flex-col gap-1.5">
        {STAGE_ORDER.map((key, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li key={key} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  done && "bg-success",
                  active && "bg-brand motion-safe:animate-pulse",
                  !done && !active && "bg-border",
                )}
              />
              <span
                className={cn(
                  "text-xs",
                  active ? "text-ink" : done ? "text-ink-muted" : "text-ink-faint",
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

function WrongChainPill({ onFix }: { onFix: () => Promise<void> }) {
  return (
    <button
      type="button"
      onClick={() => void onFix()}
      title={`Switch to ${CHAIN.name}`}
      className="rounded-full"
    >
      <Badge tone="warn">Wrong network, switch to {CHAIN.name}</Badge>
    </button>
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
