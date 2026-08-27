"use client";

import { motion, useReducedMotion } from "framer-motion";

import { WolfHead } from "./wolf-head";

const META = [
  { label: "Identity", value: "W3C DID" },
  { label: "Access", value: "Onchain RBAC" },
  { label: "Assets", value: "ERC-721" },
  { label: "Audit", value: "Immutable" },
];

/**
 * Hero.
 *
 * Reading order is label, headline, one supporting sentence, the action, then the
 * wolf head directly beneath it. The head is in normal flow rather than absolutely
 * positioned, so it always sits under the button and can never ride over the type.
 */
export function Hero() {
  const reduceMotion = useReducedMotion();
  const lines = ["Own it ", "Prove it ","Onchain "];

  return (
    <section
      id="top"
      className="gradient-mint relative flex flex-col overflow-hidden"
    >
      <div aria-hidden className="grid-backdrop absolute inset-0 opacity-70" />

      <div className="page-container relative z-10 flex flex-col items-center pt-16 text-center sm:pt-20">
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
            className="rounded-full bg-brand px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-brand-ink transition-colors duration-200 hover:bg-brand-hover"
          >
            Get started
          </a>
        </motion.div>

        {/* Directly below the action, in flow. */}
        <WolfHead className="mt-10 h-[38vh] max-h-[22rem] w-full max-w-2xl sm:mt-12" />
      </div>

      <dl className="page-container relative z-10 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border/60 pt-5 pb-20 sm:pb-6 lg:grid-cols-4">
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
