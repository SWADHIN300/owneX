"use client";

import Link from "next/link";
import Image from "next/image";

import { cn } from "@/lib/cn";
import type { AssetSummary } from "@/lib/api";
import { Badge, GlassCard, VerificationBadge } from "@/components/ui";

/**
 * The face of a certificate that has no photograph.
 *
 * These NFTs are asset certificates, not avatars, so the intended image is a
 * photo of the equipment or licence. When there is none, a random-looking
 * picture would be a lie. Instead the face is drawn from the on-chain asset
 * hash: the same asset always produces the same figure, and two assets never
 * produce the same one, which makes it an identifier rather than decoration.
 */
function CertificateFace({ assetHash, tokenId }: { assetHash: string; tokenId: number }) {
  // 8 nibbles of the anchor is plenty to place a few arcs deterministically.
  const seed = assetHash.replace(/^0x/, "").slice(0, 12);
  const nibble = (i: number) => parseInt(seed[i % seed.length] ?? "0", 16);

  const rings = [0, 1, 2, 3].map((i) => ({
    r: 22 + i * 11 + nibble(i) * 0.7,
    rotate: nibble(i + 4) * 22.5,
    dash: 4 + nibble(i + 8),
  }));

  return (
    <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-md gradient-canopy">
      <svg
        viewBox="0 0 200 128"
        className="absolute inset-0 size-full text-white/25"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        {rings.map((ring, i) => (
          <circle
            key={i}
            cx="100"
            cy="64"
            r={ring.r}
            strokeWidth="1"
            strokeDasharray={`${ring.dash} ${ring.dash + 3}`}
            transform={`rotate(${ring.rotate} 100 64)`}
          />
        ))}
        <path d="M0 64h200M100 0v128" strokeWidth="0.75" strokeDasharray="2 6" />
      </svg>
      <span className="relative font-mono text-2xl font-bold tracking-tight text-white">
        #{tokenId}
      </span>
    </div>
  );
}

/**
 * `next/image` throws when a remote host is not in `remotePatterns`, and one
 * throw takes the whole vault down. `image_url` is a free-text column, so it
 * cannot be assumed to point at the configured Supabase bucket: anything else
 * falls back to the drawn face instead.
 */
function isDisplayableImage(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}

/**
 * One asset in the vault.
 *
 * Integrity is shown, never suppressed. A tampered record is the single most
 * important thing on this card, so it gets the border as well as the badge: the
 * whole point of anchoring a hash is that the mismatch is visible.
 */
export function CertificateCard({
  asset,
  serialMasked,
}: {
  asset: AssetSummary;
  /** True when the caller's role is not allowed to see full serial numbers. */
  serialMasked: boolean;
}) {
  const tampered = asset.recordIntact === false;

  return (
    <GlassCard
      padding="md"
      interactive
      className={cn(
        "flex flex-col",
        tampered && "border-danger/50",
        !asset.active && !tampered && "border-warn/45",
      )}
    >
      {isDisplayableImage(asset.imageUrl) ? (
        <div className="relative h-32 overflow-hidden rounded-md bg-surface-2">
          <Image
            src={asset.imageUrl}
            alt={`Photograph of ${asset.name}`}
            fill
            sizes="(min-width: 1280px) 22rem, (min-width: 640px) 44vw, 88vw"
            className="object-cover"
          />
        </div>
      ) : (
        <CertificateFace assetHash={asset.assetHash} tokenId={asset.tokenId} />
      )}

      <div className="mt-4 flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold text-ink">
          <Link
            href={`/dashboard/assets/${asset.tokenId}`}
            className="hover:underline"
          >
            {asset.name}
          </Link>
        </h3>
        <Badge tone="neutral" mono>
          #{asset.tokenId}
        </Badge>
      </div>

      <p className="mt-1.5 flex flex-wrap gap-1.5">
        <Badge tone="brand">{asset.assetType}</Badge>
        {asset.department ? <Badge tone="neutral">{asset.department}</Badge> : null}
      </p>

      <dl className="mt-4 flex flex-col gap-2 border-t border-border-soft pt-3 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="label-xs text-ink-faint">Held by</dt>
          <dd className="truncate font-mono text-xs text-ink">
            {asset.assignedTo.slice(0, 6)}…{asset.assignedTo.slice(-4)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="label-xs text-ink-faint">Serial</dt>
          <dd className="truncate font-mono text-xs text-ink">
            {asset.serialNumber ?? "Not recorded"}
            {serialMasked && asset.serialNumber ? (
              <span className="sr-only"> (masked; needs Admin or Manager)</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {asset.active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="warn">Revoked</Badge>
        )}
        {asset.recordIntact === null ? (
          <Badge tone="neutral">No record to compare</Badge>
        ) : asset.recordIntact ? (
          <VerificationBadge state="verified" />
        ) : (
          <VerificationBadge state="tampered" withHint />
        )}
      </div>

      <Link
        href={`/dashboard/assets/${asset.tokenId}`}
        className="mt-4 inline-block font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
      >
        Open certificate
      </Link>
    </GlassCard>
  );
}
