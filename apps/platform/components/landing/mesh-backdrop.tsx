"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";

/**
 * The node-and-edge mesh behind the hero.
 *
 * An identity graph: wallet-bound identities as nodes, the permissions and
 * custody links between them as edges, and a signature travelling along an edge
 * to suggest a live protocol. Geometry is fixed rather than random so the layout
 * is identical on the server and the client, and every animated property is a
 * transform or opacity so the scene composites on the GPU.
 */

interface Node {
  id: string;
  x: number;
  y: number;
  r: number;
  kind: "identity" | "org" | "asset";
  label?: string;
}

const NODES: Node[] = [
  { id: "org", x: 300, y: 210, r: 22, kind: "org", label: "ORG" },
  { id: "i1", x: 148, y: 116, r: 12, kind: "identity", label: "DID" },
  { id: "i2", x: 452, y: 128, r: 12, kind: "identity" },
  { id: "i3", x: 96, y: 286, r: 11, kind: "identity" },
  { id: "i4", x: 506, y: 296, r: 11, kind: "identity" },
  { id: "a1", x: 210, y: 372, r: 14, kind: "asset", label: "NFT" },
  { id: "a2", x: 396, y: 386, r: 14, kind: "asset" },
  { id: "a3", x: 300, y: 452, r: 10, kind: "asset" },
];

const EDGES: [string, string][] = [
  ["org", "i1"],
  ["org", "i2"],
  ["org", "i3"],
  ["org", "i4"],
  ["org", "a1"],
  ["org", "a2"],
  ["i1", "i3"],
  ["i2", "i4"],
  ["i1", "a1"],
  ["i2", "a2"],
  ["a1", "a3"],
  ["a2", "a3"],
];

const BY_ID = new Map(NODES.map((node) => [node.id, node]));

const FILL: Record<Node["kind"], string> = {
  org: "var(--brand)",
  identity: "var(--accent)",
  asset: "var(--data)",
};

export function MeshBackdrop({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      data-slot="mesh-backdrop"
      className={cn("relative aspect-square w-full", className)}
    >
      {/* Soft halo so the graph sits on light rather than floating in space. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: "var(--glow)" }}
      />

      <svg
        viewBox="0 0 600 560"
        className="relative h-full w-full overflow-visible"
        aria-hidden="true"
      >
        {/* Edges. */}
        {EDGES.map(([fromId, toId], index) => {
          const from = BY_ID.get(fromId);
          const to = BY_ID.get(toId);
          if (!from || !to) return null;
          return (
            <motion.line
              key={`${fromId}-${toId}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--brand)"
              strokeOpacity={0.26}
              strokeWidth={1.2}
              initial={reduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: reduceMotion ? 0 : 0.9,
                delay: reduceMotion ? 0 : 0.1 + index * 0.05,
                ease: "easeOut",
              }}
            />
          );
        })}

        {/* A signature travelling from an identity into the organisation. */}
        {!reduceMotion ? (
          <motion.circle
            r="4"
            fill="var(--accent)"
            initial={{ cx: 148, cy: 116, opacity: 0 }}
            animate={{
              cx: [148, 300, 210],
              cy: [116, 210, 372],
              opacity: [0, 1, 1, 0],
            }}
            transition={{
              duration: 4.2,
              repeat: Infinity,
              repeatDelay: 1.4,
              ease: "easeInOut",
              times: [0, 0.45, 1],
            }}
          />
        ) : null}

        {/* Nodes. */}
        {NODES.map((node, index) => (
          <motion.g
            key={node.id}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: reduceMotion ? 0 : 0.5,
              delay: reduceMotion ? 0 : 0.2 + index * 0.07,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{ transformOrigin: `${node.x}px ${node.y}px` }}
          >
            {node.kind === "org" ? (
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r + 12}
                fill="none"
                stroke="var(--brand)"
                strokeOpacity={0.3}
                strokeDasharray="3 6"
              />
            ) : null}
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={FILL[node.kind]}
              fillOpacity={node.kind === "org" ? 1 : 0.9}
            />
            {node.kind !== "org" ? (
              <motion.circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill="none"
                stroke={FILL[node.kind]}
                strokeOpacity={0.5}
                animate={
                  reduceMotion ? undefined : { r: [node.r, node.r + 9], opacity: [0.5, 0] }
                }
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  delay: index * 0.4,
                  ease: "easeOut",
                }}
              />
            ) : null}
          </motion.g>
        ))}
      </svg>

      {/* Labels in HTML so the type stays crisp. */}
      <span className="label-xs absolute left-[18%] top-[14%] hidden rounded-full border border-border bg-surface/85 px-2 py-1 text-accent sm:block">
        DID
      </span>
      <span className="label-xs absolute left-[46%] top-[34%] hidden rounded-full border border-brand-line bg-brand px-2 py-1 text-brand-ink sm:block">
        ORG
      </span>
      <span className="label-xs absolute left-[28%] top-[70%] hidden rounded-full border border-border bg-surface/85 px-2 py-1 text-data sm:block">
        NFT
      </span>
    </div>
  );
}
