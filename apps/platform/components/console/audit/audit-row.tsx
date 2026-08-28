"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";
import type { AuditEvent } from "@/lib/api";
import { Badge, Identicon } from "@/components/ui";
import { MonoValue, explorerTxUrl } from "@/components/console/copy-field";
import { describeEvent, eventSeverity, humaniseEvent } from "./audit-events";

/**
 * One entry in the trail.
 *
 * Rows reveal in sequence when a page arrives, which makes it obvious that new
 * entries were appended rather than the whole list being replaced. The stagger is
 * capped so the tenth row is not still animating after the user has started
 * reading, and under `prefers-reduced-motion` every duration and delay is zero.
 */
export function AuditRow({
  event,
  index,
  isLast,
}: {
  event: AuditEvent;
  index: number;
  isLast: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const severity = eventSeverity(event.event);
  const explorerUrl = event.explorerUrl ?? explorerTxUrl(event.txHash);

  return (
    <motion.li
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.28,
        delay: reduceMotion ? 0 : Math.min(index, 8) * 0.035,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="relative flex gap-4 ps-1"
    >
      {/* Rail. The line is decorative; the dot's shape carries the severity. */}
      <span aria-hidden className="relative flex w-4 shrink-0 justify-center">
        {!isLast ? (
          <span className="absolute top-5 bottom-0 w-px bg-border" />
        ) : null}
        <span
          className={cn(
            "relative z-10 mt-3 size-3 border",
            severity === "grant" && "rounded-full border-success bg-success/25",
            severity === "withdraw" &&
              "rotate-45 rounded-[1px] border-danger bg-danger/25",
            severity === "neutral" && "rounded-[1px] border-border bg-surface-3",
          )}
        />
      </span>

      <div className="min-w-0 flex-1 border-b border-border-soft pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">
            {humaniseEvent(event.event)}
          </h3>
          <Badge tone="neutral" mono>
            {event.event}
          </Badge>
          <Badge tone="brand">{event.contract}</Badge>
          {event.tokenId !== null ? (
            <Link href={`/dashboard/assets/${event.tokenId}`}>
              <Badge tone="accent" mono className="hover:underline">
                Token #{event.tokenId}
              </Badge>
            </Link>
          ) : null}
        </div>

        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {describeEvent(event.event)}
        </p>

        {/* Who did it, and to whom. Both are optional: some events have neither. */}
        {event.actor || event.subject ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {event.actor ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="label-xs text-ink-faint">By</span>
                <Identicon value={event.actor} size={20} />
                <MonoValue value={event.actor} label="actor address" tail={6} head={8} />
              </span>
            ) : null}
            {event.subject && event.subject !== event.actor ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="label-xs text-ink-faint">On</span>
                <Identicon value={event.subject} size={20} />
                <MonoValue value={event.subject} label="subject address" tail={6} head={8} />
              </span>
            ) : null}
          </div>
        ) : null}

        <Payload payload={event.payload} />

        {/* The receipt. This is what makes the entry checkable by anyone. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="label-xs text-ink-faint">Tx</span>
            <MonoValue
              value={event.txHash}
              label="transaction hash"
              href={explorerUrl}
              head={10}
              tail={8}
            />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="label-xs text-ink-faint">Block</span>
            <span className="font-mono text-xs text-ink">{event.blockNumber}</span>
          </span>
        </div>
      </div>
    </motion.li>
  );
}

/**
 * The decoded event arguments.
 *
 * Addresses and hashes already appear above, so they are dropped here rather
 * than printed twice; what is left is the detail that is specific to the event,
 * such as which role was assigned or which permission changed.
 */
function Payload({ payload }: { payload: Record<string, unknown> | null }) {
  if (!payload) return null;

  const entries = Object.entries(payload).filter(([key, value]) => {
    if (value === null || value === undefined || value === "") return false;
    if (/^(by|wallet|orgId|tokenId)$/i.test(key)) return false;
    if (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)) return false;
    return true;
  });

  if (entries.length === 0) return null;

  return (
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="label-xs text-ink-faint">{humaniseKey(key)}</dt>
          <dd className="truncate font-mono text-xs text-ink" title={String(value)}>
            {formatValue(key, value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(key: string, value: unknown): string {
  // `expiresAt` of 0 means permanent in the contract, not "the epoch".
  if (/expir/i.test(key)) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return seconds === 0 ? "never" : new Date(seconds * 1000).toLocaleString();
    }
  }
  // Contract timestamps are unix seconds. Left raw they read as an eleven-digit
  // number, which tells a reader nothing.
  if (/^(at|timestamp|joinedAt|createdAt|mintedAt)$/i.test(key)) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(seconds * 1000).toLocaleString();
    }
  }
  const text = String(value);
  return text.length > 42 ? `${text.slice(0, 20)}…${text.slice(-12)}` : text;
}
