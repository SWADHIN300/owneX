"use client";

import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";

/**
 * The hero object: a brilliant-cut diamond rising through the baseline, the way
 * the reference lets its mascot break the bottom edge.
 *
 * Geometry follows a real cut so it reads as one solid object rather than a set
 * of shapes: a flat table on top, a girdle at the widest point, and a pavilion
 * running down to the culet below the fold. Facets are flat fills with no
 * gradients, and lighting is faked purely by tone, which is what makes it look
 * cut instead of drawn.
 *
 * It is the only warm thing on the page, and it echoes the diamond in the owneX
 * mark. Facets settle once on load rather than looping, so nothing competes with
 * the headline after the page comes to rest.
 */

interface Facet {
  points: string;
  fill: string;
  /** Distance the facet travels in from, so the stone assembles downward. */
  from: number;
}

// Table at y=90 (x 225 to 375), girdle at y=250 (x 60 to 540), culet at y=560.
// Fills come from tokens, so the stone is dark emerald on the lime canvas and
// warm on the deep green one without this file knowing which theme is active.
const FACETS: Facet[] = [
  // Crown, left to right. Tone lifts toward the centre to suggest a light source.
  { points: "225,90 60,250 180,250", fill: "var(--facet-dark)", from: 26 },
  { points: "225,90 180,250 300,250", fill: "var(--facet-mid)", from: 22 },
  { points: "225,90 375,90 300,250", fill: "var(--facet-light)", from: 18 },
  { points: "375,90 300,250 420,250", fill: "var(--facet-midlight)", from: 22 },
  { points: "375,90 420,250 540,250", fill: "var(--facet-dark)", from: 26 },

  // Pavilion. The right side is the shadow side, which gives the stone volume.
  { points: "60,250 300,250 300,560", fill: "var(--facet-mid)", from: 40 },
  { points: "540,250 300,250 300,560", fill: "var(--facet-darkest)", from: 40 },
  // Inner reflection running down the axis.
  { points: "180,250 420,250 300,470", fill: "var(--facet-midlight)", from: 32 },
];

// Seams drawn in the page colour, so the facets read as cut edges.
const SEAMS =
  "M225,90 L375,90 M60,250 L540,250 M225,90 L180,250 M225,90 L300,250 M375,90 L300,250 M375,90 L420,250 M300,250 L300,560 M180,250 L300,470 M420,250 L300,470";

export function HeroObject({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none relative w-full", className)}
    >
      {/* Bloom, so the stone sits in the page rather than on top of it. */}
      <div
        className="absolute bottom-0 left-1/2 h-2/3 w-[62%] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "var(--glow)" }}
      />

      <svg
        viewBox="0 0 600 560"
        className="relative h-full w-full"
        preserveAspectRatio="xMidYMax meet"
      >
        {FACETS.map((facet, index) => (
          <motion.polygon
            key={facet.points}
            points={facet.points}
            fill={facet.fill}
            initial={
              reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: facet.from }
            }
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.75,
              delay: reduceMotion ? 0 : 0.3 + index * 0.055,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        ))}

        <motion.path
          d={SEAMS}
          stroke="var(--background)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          initial={reduceMotion ? { opacity: 0.45 } : { opacity: 0 }}
          animate={{ opacity: 0.45 }}
          transition={{
            duration: reduceMotion ? 0 : 0.6,
            delay: reduceMotion ? 0 : 0.95,
          }}
        />
      </svg>
    </div>
  );
}
