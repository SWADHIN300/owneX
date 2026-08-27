"use client";

import * as React from "react";

import { cn } from "@/lib/cn";
import { CHAIN } from "@/lib/wallet";

/**
 * Copy control for the values this app is full of: addresses, transaction
 * hashes, keccak anchors. Nobody transcribes a 66-character hash by hand, so a
 * hash shown without a copy button is decoration.
 *
 * Icon-only, so it carries an explicit label naming what it copies, and the
 * confirmation goes into a live region rather than only changing the icon.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** What is being copied, for the accessible name. "transaction hash". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be refused outright (insecure origin, denied
      // permission). Selecting the text is the honest fallback; silently
      // pretending it worked is not.
      setCopied(false);
      return;
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-sm",
          "text-ink-faint transition-colors duration-200 hover:bg-surface-2 hover:text-ink",
          className,
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {copied ? (
            <path d="M3 8.5l3.5 3.5L13 5" />
          ) : (
            <>
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 2.5H3.5a1 1 0 0 0-1 1v7" />
            </>
          )}
        </svg>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${label} copied to the clipboard` : ""}
      </span>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A long protocol value: shown truncated in the middle so both ends stay
 * readable, copyable in full, and linked to an explorer when one is configured.
 *
 * The full value is in the `title` and in a visually hidden span, so it is
 * available to a screen reader and to text search even though it is elided on
 * screen.
 */
export function MonoValue({
  value,
  label,
  href,
  head = 10,
  tail = 8,
  className,
}: {
  value: string;
  label: string;
  href?: string | null;
  head?: number;
  tail?: number;
  className?: string;
}) {
  const shown =
    value.length > head + tail + 3
      ? `${value.slice(0, head)}…${value.slice(-tail)}`
      : value;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={value}
          className="truncate font-mono text-xs text-accent underline decoration-dotted underline-offset-2"
        >
          {shown}
        </a>
      ) : (
        <span title={value} className="truncate font-mono text-xs text-ink">
          {shown}
        </span>
      )}
      <span className="sr-only">{value}</span>
      <CopyButton value={value} label={label} />
    </span>
  );
}

/**
 * Explorer URL for a transaction, or null when no explorer is configured.
 *
 * A local Hardhat node has no explorer, which is the default here, so the link
 * has to be able to not exist rather than pointing somewhere broken.
 */
export function explorerTxUrl(txHash: string): string | null {
  if (!CHAIN.explorer) return null;
  return `${CHAIN.explorer.replace(/\/$/, "")}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string | null {
  if (!CHAIN.explorer) return null;
  return `${CHAIN.explorer.replace(/\/$/, "")}/address/${address}`;
}
