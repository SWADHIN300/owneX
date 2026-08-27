"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

import {
  Badge,
  GlassCard,
  Identicon,
  RoleChip,
  VerificationBadge,
} from "@/components/ui";

/**
 * The four things that make owneX more than a CRUD app with a wallet button.
 * Each card shows the actual design system component that represents the idea,
 * so the section doubles as a live preview of the system.
 */
export function Capabilities() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2, once: true });
  const reduceMotion = useReducedMotion();

  const cards = [
    {
      title: "Roles expire on their own",
      body: "A contractor's access lapses at a block deadline instead of depending on somebody remembering to revoke it.",
      visual: (
        <div className="flex flex-wrap gap-2">
          <RoleChip role="MANAGER" expiresAt="30 Sep" />
          <RoleChip role="AUDITOR" />
          <RoleChip role="NONE" />
        </div>
      ),
    },
    {
      title: "Company assets cannot be sold",
      body: "The holder genuinely owns the certificate and can prove custody, but transferFrom reverts. Custody without alienability.",
      visual: (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="data" mono>
            ERC-721
          </Badge>
          <Badge tone="warn" mono>
            TRANSFERS LOCKED
          </Badge>
        </div>
      ),
    },
    {
      title: "Revocation cascades in one block",
      body: "Revoking an identity drops its role to NONE across every organisation, permission, connected app and ownership check.",
      visual: (
        <div className="flex items-center gap-2">
          <Identicon value="0x69FD7a4C1b2E5d8A9f0C3b6E1d4A7c2F5b83888" size={28} />
          <span aria-hidden className="text-ink-faint">
            &rarr;
          </span>
          <VerificationBadge state="revoked" />
        </div>
      ),
    },
    {
      title: "Nothing personal is onchain",
      body: "Only keccak256 anchors. Re-hash the encrypted record and compare: a match proves it is unmodified, a mismatch proves it was edited.",
      visual: (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success" mono>
            0 PII FIELDS
          </Badge>
          <VerificationBadge state="verified" />
        </div>
      ),
    },
  ];

  return (
    <section id="capabilities" className="border-b border-border bg-surface-2">
      <div ref={ref} className="page-container py-16 sm:py-24">
        <div className="mb-12 grid gap-6 md:grid-cols-2 md:items-end">
          <div>
            <p className="label-xs mb-4 text-accent">Capabilities</p>
            <h2 className="display text-3xl font-semibold text-ink sm:text-4xl">
              Four decisions that
              <br />
              carry the design.
            </h2>
          </div>
          <p className="max-w-md text-base leading-relaxed text-ink-muted md:justify-self-end">
            Each one is enforced in Solidity and covered by tests, not described
            in a roadmap.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card, index) => (
            <motion.div
              key={card.title}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{
                duration: reduceMotion ? 0 : 0.55,
                delay: reduceMotion ? 0 : index * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <GlassCard interactive className="flex h-full flex-col justify-between gap-6">
                <div>
                  <h3 className="mb-2.5 text-base font-semibold text-ink">
                    {card.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-ink-muted">
                    {card.body}
                  </p>
                </div>
                <div>{card.visual}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
