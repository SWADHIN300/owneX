"use client";

import type { DiscoveredWallet } from "@/lib/wallet";

/**
 * The list of detected wallets.
 *
 * Shared by the topbar popover and the hero modal so there is one implementation
 * of wallet choice rather than two that can drift apart.
 */
export function WalletList({
  wallets,
  onPick,
}: {
  wallets: DiscoveredWallet[];
  onPick: (wallet: DiscoveredWallet) => void;
}) {
  return (
    <div>
      <p className="label-xs mb-2.5 text-ink-faint">
        {wallets.length} wallet{wallets.length === 1 ? "" : "s"} detected
      </p>
      <ul className="flex flex-col gap-1">
        {wallets.map((wallet) => (
          <li key={wallet.info.rdns}>
            <button
              type="button"
              onClick={() => onPick(wallet)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start transition-colors duration-150 hover:bg-brand-soft"
            >
              {wallet.info.icon ? (
                // Wallet-supplied data URI, already at icon size. next/image
                // cannot optimise a data URI, so a plain img is correct here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={wallet.info.icon}
                  alt=""
                  width={24}
                  height={24}
                  className="size-6 shrink-0 rounded-md"
                />
              ) : (
                <span
                  aria-hidden
                  className="size-6 shrink-0 rounded-md border border-border bg-surface-2"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {wallet.info.name}
              </span>
              <span aria-hidden className="text-ink-faint">
                &rarr;
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 border-t border-border-soft pt-2 text-[0.625rem] text-ink-faint">
        No gas, no transaction. This is a signature only.
      </p>
    </div>
  );
}
