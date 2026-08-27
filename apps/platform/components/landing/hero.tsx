"use client";

import { motion, useReducedMotion } from "framer-motion";

import { HeroObject } from "./hero-object";

const META = [
  { label: "Identity", value: "W3C DID" },
  { label: "Access", value: "Onchain RBAC" },
  { label: "Assets", value: "ERC-721" },
  { label: "Audit", value: "Immutable" },
];

/**
 * Full-viewport hero.
 *
 * Reading order is label, headline, one supporting sentence, then the action. The
 * stone sits below all of it and breaks the bottom edge, so nothing overlaps the
 * type. The metadata rail carries extra bottom padding on small screens, where the
 * announcement strip would otherwise sit on top of it.
 */
export function Hero() {
  const reduceMotion = useReducedMotion();
  const lines = ["Own it.", "Prove it.", "Onchain."];

  return (
    <section
      id="top"
      className="relative flex min-h-[100svh] flex-col overflow-hidden bg-background"
    >
      <div aria-hidden className="grid-backdrop absolute inset-0 opacity-70" />

      <div className="page-container relative z-20 flex flex-1 flex-col items-center justify-center pt-28 pb-[26rem] text-center sm:pb-[24rem] lg:pb-[22rem]">
        <motion.p
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.5 }}
          className="label-xs mb-7 text-accent"
        >
          Decentralised trust infrastructure
        </motion.p>

        <h1 className="display mb-8 text-ink">
          {lines.map((line, index) => (
            <motion.span
              key={line}
              className="block text-[clamp(2.5rem,11.5vw,9rem)]"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.7,
                delay: reduceMotion ? 0 : index * 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {line}
            </motion.span>
          ))}
        </h1>

        <motion.div
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.6,
            delay: reduceMotion ? 0 : 0.4,
          }}
          className="flex flex-col items-center gap-7"
        >
          <p className="max-w-lg font-sans text-sm leading-relaxed text-ink-muted sm:text-base">
            Verifiable identities, permissions enforced by smart contracts, and
            asset ownership anyone can check. Personal data never touches the
            chain.
          </p>

          <a
            href="#how-it-works"
            className="rounded-full bg-ink px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-background transition-transform duration-200 hover:scale-[1.02] motion-reduce:hover:scale-100"
          >
            Get started
          </a>
        </motion.div>
      </div>

      {/* The stone breaks the baseline, behind the type block. */}
      <HeroObject className="absolute inset-x-0 bottom-0 z-10 h-[44vh] max-h-[26rem]" />

      <dl className="page-container relative z-20 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border/60 pt-5 pb-20 sm:pb-6 lg:grid-cols-4">
        {META.map((item) => (
          <div key={item.label} className="flex items-baseline gap-3">
            <dt className="label-xs text-ink-faint">{item.label}</dt>
            <dd className="font-mono text-xs text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
