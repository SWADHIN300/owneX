"use client";

import { cn } from "@/lib/cn";
import type { DecodedFailure } from "@/lib/tx-errors";
import { Badge } from "@/components/ui";
import { MonoValue, explorerTxUrl } from "@/components/console/copy-field";
import {
  TX_STAGE_LABEL,
  TX_STAGE_ORDER,
  type TxStage,
} from "./use-transaction";

/**
 * The four stages, so a stall is attributable to one of them.
 *
 * Deliberately the same shape as the sign-in rail: once somebody has watched one
 * of these, they can read the other without learning anything new. The
 * transaction hash appears as soon as it exists, which is the moment it becomes
 * checkable independently of this interface.
 */
export function TransactionRail({
  stage,
  txHash,
  className,
}: {
  stage: TxStage;
  txHash: string | null;
  className?: string;
}) {
  if (stage === "idle") return null;

  const activeIndex = TX_STAGE_ORDER.indexOf(stage as (typeof TX_STAGE_ORDER)[number]);
  const finished = stage === "done";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("rounded-md border border-border bg-surface-2 p-3", className)}
    >
      <p className="label-xs mb-2.5 text-ink-faint">
        {finished ? "Done" : stage === "error" ? "Stopped" : "In progress"}
      </p>
      <ol className="flex flex-col gap-1.5">
        {TX_STAGE_ORDER.map((key, index) => {
          const done = finished || index < activeIndex;
          const current = !finished && index === activeIndex;
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
                {TX_STAGE_LABEL[key]}
              </span>
            </li>
          );
        })}
      </ol>

      {txHash ? (
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border-soft pt-2">
          <span className="label-xs text-ink-faint">Tx</span>
          <MonoValue
            value={txHash}
            label="transaction hash"
            href={explorerTxUrl(txHash)}
            head={10}
            tail={8}
          />
        </p>
      ) : null}
    </div>
  );
}

/**
 * A refused transaction.
 *
 * The contract's own error name is shown beside the explanation, because that is
 * the string somebody debugging this will search for — and it proves the message
 * above it was decoded rather than guessed.
 */
export function TransactionFailure({ failure }: { failure: DecodedFailure | null }) {
  if (!failure || failure.rejected) return null;

  return (
    <div
      role="alert"
      className="rounded-md border border-danger/45 bg-danger/10 p-3"
    >
      <p className="label-xs mb-2 flex flex-wrap items-center gap-2 text-danger">
        The contract refused this
        {failure.errorName ? (
          <Badge tone="danger" mono>
            {failure.errorName}
          </Badge>
        ) : null}
      </p>
      <p className="text-xs leading-relaxed text-ink">{failure.message}</p>
    </div>
  );
}

/** A dismissed wallet prompt. Stated once, quietly, with no alarm. */
export function TransactionDismissed({ failure }: { failure: DecodedFailure | null }) {
  if (!failure?.rejected) return null;
  return (
    <p role="status" className="text-xs text-ink-faint">
      {failure.message}
    </p>
  );
}
