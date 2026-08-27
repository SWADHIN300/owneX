"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";

const STEPS = [
  {
    index: "01",
    title: "Register an identity",
    body: "A wallet signs in with EIP-4361. The chain stores a hash of the profile, never the profile.",
  },
  {
    index: "02",
    title: "Create the organisation",
    body: "The creator becomes root admin and cannot be locked out of governance.",
  },
  {
    index: "03",
    title: "Assign a role",
    body: "Admin, Manager, Auditor or User, with an optional expiry that lapses on its own.",
  },
  {
    index: "04",
    title: "Issue the asset",
    body: "Encrypt the record off-chain, anchor its hash, then mint a certificate to the holder.",
  },
  {
    index: "05",
    title: "Prove it",
    body: "Any third party checks the holder and re-derives the hash without asking the operator.",
  },
  {
    index: "06",
    title: "Revoke",
    body: "One transaction drops roles, permissions and app access across every organisation.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-border">
      <div className="page-container py-16 sm:py-24">
        <div className="mb-12 grid gap-6 md:grid-cols-2 md:items-end">
          <div>
            <p className="label-xs mb-4 text-accent">How it works</p>
            <h2 className="display-sm text-3xl font-semibold text-ink sm:text-4xl">
              Six steps, each one
              <br />
              an onchain event.
            </h2>
          </div>
          <p className="max-w-md text-base leading-relaxed text-ink-muted md:justify-self-end">
            Nothing here depends on trusting the platform. Every step is enforced
            by a contract and leaves a record the operator cannot edit.
          </p>
        </div>

        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <Step key={step.index} {...step} order={index} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function Step({
  index,
  title,
  body,
  order,
}: {
  index: string;
  title: string;
  body: string;
  order: number;
}) {
  const ref = React.useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { amount: 0.3, once: true });
  const reduceMotion = useReducedMotion();

  return (
    <motion.li
      ref={ref}
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 18 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{
        duration: reduceMotion ? 0 : 0.5,
        delay: reduceMotion ? 0 : order * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        "group rounded-xl border border-border bg-surface p-5",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card",
        "motion-reduce:hover:translate-y-0",
      )}
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-lg bg-brand-soft font-mono text-xs font-semibold text-brand">
          {index}
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      <h3 className="mb-2 text-base font-semibold text-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
    </motion.li>
  );
}
