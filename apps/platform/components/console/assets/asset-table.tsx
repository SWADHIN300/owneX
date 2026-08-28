"use client";

import Link from "next/link";

import type { AssetSummary } from "@/lib/api";
import { Badge, GlassCard, VerificationBadge } from "@/components/ui";

/**
 * The table alternative to the card grid.
 *
 * Cards are better for recognising one certificate; a table is better for
 * comparing forty, which is why both exist rather than one winning. It is a real
 * `<table>` with a caption and scope on every header, so it is navigable by row
 * and column in a screen reader.
 *
 * On narrow screens the table scrolls horizontally inside its own container
 * rather than the page. `diagnose-overflow.mjs` ignores elements inside a
 * deliberate scroller, and this is one.
 */
export function AssetTable({ assets }: { assets: AssetSummary[] }) {
  return (
    <GlassCard padding="none" className="overflow-hidden">
      {/* `relative` keeps visually hidden labels — which are absolutely
          positioned — inside the scroll container, so one of them cannot widen
          the whole page from inside a table that is meant to scroll on its own. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-start">
          <caption className="sr-only">
            Asset certificates in this organisation, with holder, status and
            record integrity.
          </caption>
          <thead>
            <tr className="border-b border-border">
              <Th>Token</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Department</Th>
              <Th>Held by</Th>
              <Th>Status</Th>
              <Th>Integrity</Th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr
                key={asset.tokenId}
                className="border-b border-border-soft last:border-0 hover:bg-brand-soft/50"
              >
                <Td>
                  <span className="font-mono text-xs text-ink-muted">
                    #{asset.tokenId}
                  </span>
                </Td>
                <Td>
                  <Link
                    href={`/dashboard/assets/${asset.tokenId}`}
                    className="text-sm font-medium text-ink hover:underline"
                  >
                    {asset.name}
                  </Link>
                </Td>
                <Td>
                  <span className="text-xs text-ink-muted">{asset.assetType}</span>
                </Td>
                <Td>
                  <span className="text-xs text-ink-muted">
                    {asset.department ?? "—"}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-ink-muted">
                    {asset.assignedTo.slice(0, 6)}…{asset.assignedTo.slice(-4)}
                  </span>
                </Td>
                <Td>
                  {asset.active ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="warn">Revoked</Badge>
                  )}
                </Td>
                <Td>
                  {asset.recordIntact === null ? (
                    <Badge tone="neutral">No record</Badge>
                  ) : asset.recordIntact ? (
                    <VerificationBadge state="verified" />
                  ) : (
                    <VerificationBadge state="tampered" />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="label-xs px-4 py-3 text-start whitespace-nowrap text-ink-faint"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
}
