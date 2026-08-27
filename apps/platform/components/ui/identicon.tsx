import { cn } from "@/lib/cn";

/**
 * Deterministic identicon for a wallet address or DID.
 *
 * The same input always produces the same mark: a 32-bit FNV-1a hash seeds a
 * 5x5 grid that is mirrored down the centre column, and picks a hue from a
 * constrained on-brand set so avatars stay distinguishable without turning the
 * interface into confetti.
 *
 * Pure SVG with no state, so it renders on the server.
 */

const HUES = [172, 186, 160, 200, 148, 214, 132, 226];

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 16777619, via shifts to stay in 32-bit range.
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash >>>= 0;
  }
  return hash >>> 0;
}

/** xorshift32: cheap, deterministic, and evenly distributed enough for a grid. */
function xorshift32(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x >>> 0;
  };
}

export interface IdenticonProps {
  /** Wallet address, DID, or any stable string. */
  value: string;
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
}

export function Identicon({ value, size = 32, className }: IdenticonProps) {
  const seed = fnv1a(value.trim().toLowerCase());
  const next = xorshift32(seed);
  const hue = HUES[seed % HUES.length];

  // Two tones of one hue: filled cells and the plate behind them.
  const fill = `hsl(${hue} 62% 34%)`;
  const plate = `hsl(${hue} 40% 92%)`;

  // 15 cells cover the left three columns; columns 0 and 1 mirror to 4 and 3.
  const filled: boolean[] = [];
  for (let i = 0; i < 15; i += 1) filled.push(next() % 100 < 52);

  // Keep the mark legible: a grid this small looks broken below five cells, so
  // top it up deterministically rather than shipping a near-blank avatar.
  let count = filled.filter(Boolean).length;
  for (let i = 0; count < 5 && i < 15; i += 1) {
    if (!filled[i]) {
      filled[i] = true;
      count += 1;
    }
  }

  const rects: { x: number; y: number }[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      if (!filled[row * 3 + col]) continue;
      rects.push({ x: col, y: row });
      if (col < 2) rects.push({ x: 4 - col, y: row });
    }
  }

  return (
    <svg
      viewBox="0 0 5 5"
      width={size}
      height={size}
      role="img"
      aria-label={`Identity avatar for ${value}`}
      data-slot="identicon"
      className={cn("shrink-0 rounded-full", className)}
      shapeRendering="crispEdges"
    >
      <rect width="5" height="5" fill={plate} />
      {rects.map((rect) => (
        <rect
          key={`${rect.x}-${rect.y}`}
          x={rect.x}
          y={rect.y}
          width="1"
          height="1"
          fill={fill}
        />
      ))}
    </svg>
  );
}
