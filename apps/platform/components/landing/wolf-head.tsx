"use client";

import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";

/**
 * The hero object: a faceted wolf head, front on.
 *
 * Built the way a low-poly model is, from flat planes with no gradients, where
 * lighting is implied purely by tone. Planes near the centre ridge are lighter and
 * the outer cheeks and ears fall away darker, which is what reads as volume rather
 * than a flat silhouette.
 *
 * Every plane shares its vertices with the plane beside it, so the ears grow out of
 * the skull instead of floating above it and no seam can open up at any size. The
 * head is symmetric about x=300.
 *
 * Fills come from `--facet-*` tokens, so it recolours per theme without this file
 * knowing which theme is active. The eyes use the vivid accent, the one place it
 * appears outside a control.
 */

interface Plane {
  points: string;
  fill: string;
  /** Distance the plane travels in from, so the head assembles outward. */
  from: number;
}

const PLANES: Plane[] = [
  // Ears. Base vertices are shared with the skull, so they are attached.
  { points: "152,66 255,205 198,262", fill: "var(--facet-darkest)", from: 34 },
  { points: "448,66 345,205 402,262", fill: "var(--facet-darkest)", from: 34 },
  // Ear inners, one tone up so each ear reads as a cone, not a flat triangle.
  { points: "152,66 255,205 205,150", fill: "var(--facet-dark)", from: 30 },
  { points: "448,66 345,205 395,150", fill: "var(--facet-dark)", from: 30 },

  // Skull, meeting at the centre ridge. The lit side is the viewer's left.
  {
    points: "255,205 300,188 300,330 205,300 198,262",
    fill: "var(--facet-light)",
    from: 22,
  },
  {
    points: "345,205 300,188 300,330 395,300 402,262",
    fill: "var(--facet-midlight)",
    from: 22,
  },

  // Cheeks, falling away from the ridge and narrowing toward the muzzle.
  { points: "205,300 300,330 286,418 192,368", fill: "var(--facet-mid)", from: 26 },
  { points: "395,300 300,330 314,418 408,368", fill: "var(--facet-dark)", from: 26 },

  // Muzzle, tapering to the nose.
  { points: "286,418 300,330 300,504", fill: "var(--facet-midlight)", from: 18 },
  { points: "314,418 300,330 300,504", fill: "var(--facet-mid)", from: 18 },

  // Jaw and neck, running off the bottom edge.
  { points: "192,368 286,418 300,560 152,560", fill: "var(--facet-dark)", from: 40 },
  {
    points: "408,368 314,418 300,560 448,560",
    fill: "var(--facet-darkest)",
    from: 40,
  },
];

// Nose pad, the darkest thing on the head, so it anchors the face.
const NOSE = "281,468 319,468 300,506";

// Eyes. Angular rather than round, which keeps the object in one language.
const EYES = [
  { points: "230,256 282,270 254,290", origin: "254px 272px" },
  { points: "370,256 318,270 346,290", origin: "346px 272px" },
];

// Seams stroked in the page colour, so planes read as folded rather than drawn.
const SEAMS = [
  "M300,188 L300,504", // centre ridge
  "M255,205 L300,188 L345,205", // brow
  "M198,262 L255,205", // left ear base
  "M402,262 L345,205", // right ear base
  "M205,300 L300,330 L395,300", // cheekbone
  "M192,368 L286,418 L314,418 L408,368", // jawline
].join(" ");

export function WolfHead({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none relative w-full", className)}
    >
      {/* Bloom, so the head sits in the page rather than on top of it. */}
      <div
        className="absolute bottom-0 left-1/2 h-2/3 w-[54%] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "var(--glow)" }}
      />

      <svg
        viewBox="0 0 600 560"
        className="relative h-full w-full"
        preserveAspectRatio="xMidYMax meet"
      >
        {PLANES.map((plane, index) => (
          <motion.polygon
            key={plane.points}
            points={plane.points}
            fill={plane.fill}
            initial={
              reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: plane.from }
            }
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.7,
              delay: reduceMotion ? 0 : 0.3 + index * 0.045,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        ))}

        <motion.polygon
          points={NOSE}
          fill="var(--facet-darkest)"
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: reduceMotion ? 0 : 0.5,
            delay: reduceMotion ? 0 : 0.85,
          }}
        />

        {EYES.map((eye, index) => (
          <motion.polygon
            key={eye.points}
            points={eye.points}
            fill="var(--accent-vivid)"
            style={{ transformOrigin: eye.origin }}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: reduceMotion ? 0 : 0.4,
              delay: reduceMotion ? 0 : 0.95 + index * 0.08,
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
          initial={reduceMotion ? { opacity: 0.4 } : { opacity: 0 }}
          animate={{ opacity: 0.4 }}
          transition={{
            duration: reduceMotion ? 0 : 0.6,
            delay: reduceMotion ? 0 : 1.05,
          }}
        />
      </svg>
    </div>
  );
}
