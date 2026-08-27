"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";
import { Badge, GlassCard, VerificationBadge } from "@/components/ui";

const ONCHAIN = [
  "Identity hash",
  "Organisation and root admin",
  "Role and expiry",
  "NFT token id and holder",
  "Asset hash",
  "Every audit event",
];

const OFFCHAIN = [
  "Name, email, phone",
  "Department and job title",
  "Asset name and description",
  "Serial numbers and invoices",
  "Images and documents",
  "Cached events for fast paging",
];

/**
 * The split that makes the privacy claim concrete: what the chain holds, what
 * stays in the encrypted database, and how a hash proves the two still agree.
 *
 * The verification step animates through match then mismatch, because the
 * mismatch case is the whole point: altering one character breaks the hash.
 */
export function SplitExplainer() {
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { amount: 0.3 });
  const reduceMotion = useReducedMotion();
  const [tampered, setTampered] = React.useState(false);

  React.useEffect(() => {
    if (!inView || reduceMotion) return;
    const id = window.setInterval(() => setTampered((value) => !value), 2600);
    return () => window.clearInterval(id);
  }, [inView, reduceMotion]);

  return (
    <section
      id="split"
      ref={sectionRef}
      className="border-b border-border bg-surface-2"
    >
      <div className="page-container py-16 sm:py-24">
        <div className="mb-12 grid gap-6 md:grid-cols-2 md:items-end">
          <div>
            <p className="label-xs mb-4 text-accent">The split</p>
            <h2 className="display-sm text-3xl font-semibold text-ink sm:text-4xl">
              Proof on the chain.
              <br />
              Personal data off it.
            </h2>
          </div>
          <p className="max-w-md text-base leading-relaxed text-ink-muted md:justify-self-end">
            Only fingerprints and state go onchain. The record itself stays
            encrypted in Postgres, which is what keeps erasure possible on an
            immutable ledger.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          <Column
            title="On the chain"
            caption="Public, permanent, verifiable"
            items={ONCHAIN}
            tone="brand"
          />

          {/* Hash bridge. */}
          <div className="flex flex-col items-center justify-center gap-3 py-2 lg:w-40">
            <div className="h-px w-full bg-border lg:h-full lg:w-px" />
            <div className="flex flex-col items-center gap-2 rounded-lg border border-brand-line bg-brand-soft px-3 py-2.5 text-center">
              <span className="label-xs text-accent">keccak256</span>
              <span className="font-mono text-[0.6875rem] text-ink-muted">
                one way
              </span>
            </div>
            <div className="h-px w-full bg-border lg:h-full lg:w-px" />
          </div>

          <Column
            title="Off the chain"
            caption="Encrypted with AES-256-GCM"
            items={OFFCHAIN}
            tone="neutral"
          />
        </div>

        {/* Verification demonstration. */}
        <GlassCard className="mt-4" padding="md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="label-xs mb-2 text-ink-faint">
                Integrity check
              </p>
              <p className="text-sm text-ink-muted">
                Re-hash the encrypted record and compare it against the anchor.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <code
                className={cn(
                  "rounded-sm border px-2.5 py-1.5 font-mono text-xs transition-colors duration-300",
                  tampered
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-success/40 bg-success/10 text-success",
                )}
              >
                {tampered ? "0x7a9f...ffe1" : "0x7a9f...c204"}
              </code>
              <motion.span
                key={tampered ? "tampered" : "verified"}
                initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
              >
                <VerificationBadge
                  state={tampered ? "tampered" : "verified"}
                  withHint
                />
              </motion.span>
            </div>
          </div>
        </GlassCard>

        <p className="mt-5 text-sm text-ink-muted">
          Delete the off-chain record and the anchor becomes a meaningless
          number. That is how a right-to-erasure request is satisfied without
          rewriting history.
        </p>
      </div>
    </section>
  );
}

function Column({
  title,
  caption,
  items,
  tone,
}: {
  title: string;
  caption: string;
  items: string[];
  tone: "brand" | "neutral";
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25, once: true });
  const reduceMotion = useReducedMotion();

  return (
    <GlassCard className="flex flex-col" padding="md">
      <div ref={ref}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <Badge tone={tone === "brand" ? "brand" : "neutral"}>{caption}</Badge>
        </div>

        <ul className="flex flex-col gap-2.5">
          {items.map((item, index) => (
            <motion.li
              key={item}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
              animate={inView ? { opacity: 1, x: 0 } : undefined}
              transition={{
                duration: reduceMotion ? 0 : 0.36,
                delay: reduceMotion ? 0 : index * 0.05,
                ease: "easeOut",
              }}
              className="flex items-start gap-2.5 text-sm text-ink-muted"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  tone === "brand" ? "bg-accent" : "bg-ink-faint",
                )}
              />
              {item}
            </motion.li>
          ))}
        </ul>
      </div>
    </GlassCard>
  );
}
