"use client";

import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/address";

import { Identicon } from "./identicon";

/** Chains this project actually targets. */
const CHAINS: Record<number, { name: string; short: string }> = {
  31337: { name: "Hardhat Local", short: "Local" },
  11155111: { name: "Sepolia", short: "Sepolia" },
  1: { name: "Ethereum", short: "Mainnet" },
};

export interface NetworkChipProps {
  chainId?: number;
  /** Chain the app expects. A mismatch is surfaced as a warning. */
  expectedChainId?: number;
  className?: string;
}

export function NetworkChip({
  chainId,
  expectedChainId,
  className,
}: NetworkChipProps) {
  const chain = chainId ? CHAINS[chainId] : undefined;
  const disconnected = !chainId;
  const wrongChain =
    !disconnected && expectedChainId !== undefined && chainId !== expectedChainId;

  const label = disconnected
    ? "No network"
    : wrongChain
      ? "Wrong network"
      : (chain?.name ?? `Chain ${chainId}`);

  const tone = disconnected
    ? "border-border bg-surface-2 text-ink-muted"
    : wrongChain
      ? "border-warn/35 bg-warn/10 text-warn"
      : "border-brand-line bg-brand-soft text-brand";

  const dot = disconnected
    ? "bg-ink-faint"
    : wrongChain
      ? "bg-warn"
      : "bg-success";

  return (
    <span
      data-slot="network-chip"
      title={
        wrongChain && expectedChainId
          ? `Connected to ${chainId}, expected ${expectedChainId}`
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1",
        "text-[0.6875rem] leading-none font-semibold whitespace-nowrap",
        tone,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          dot,
          !disconnected && !wrongChain && "motion-safe:animate-pulse",
        )}
      />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export interface WalletPillProps {
  address: string;
  /** Optional ENS or profile display name shown instead of the address. */
  displayName?: string;
  onDisconnect?: () => void;
  className?: string;
}

/** Re-exported for existing client-side imports; defined in @/lib/address. */
export { shortenAddress };

export function WalletPill({
  address,
  displayName,
  onDisconnect,
  className,
}: WalletPillProps) {
  return (
    <span
      data-slot="wallet-pill"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 ps-1 pe-1",
        className,
      )}
    >
      <Identicon value={address} size={26} />
      <span
        className="font-mono text-xs text-ink"
        title={address}
      >
        {displayName ?? shortenAddress(address)}
      </span>
      {onDisconnect ? (
        <button
          type="button"
          onClick={onDisconnect}
          aria-label="Disconnect wallet"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full",
            "text-ink-faint transition-colors duration-200 hover:bg-surface-2 hover:text-ink",
          )}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : (
        <span className="pe-2" />
      )}
    </span>
  );
}
