"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";

import {
  getAssetMetadata,
  listAssets,
  type AssetMetadata,
  type AssetSummary,
} from "@/lib/api";
import { CHAIN } from "@/lib/wallet";
import { useResource } from "@/lib/use-resource";
import {
  Badge,
  GlassCard,
  Identicon,
  VerificationBadge,
} from "@/components/ui";
import {
  ApiErrorPanel,
  LoadingPanel,
  StatePanel,
} from "@/components/console/states";
import {
  ScreenHeader,
  useConsoleScreen,
} from "@/components/console/use-console-screen";
import {
  MonoValue,
  explorerAddressUrl,
} from "@/components/console/copy-field";

/** Mirrors the vault's trust boundary: arbitrary remote image URLs are not
 * fetched by Next's image optimizer; only public objects from our asset bucket
 * are rendered as photographs. */
function isDisplayableAssetImage(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.pathname.startsWith("/storage/v1/object/public/asset-images/")
    );
  } catch {
    return false;
  }
}

/**
 * One asset certificate.
 *
 * Built from the same listing endpoint the vault uses plus the public metadata
 * route, rather than a new per-asset endpoint. That is deliberate: the listing
 * already applies the org membership check and the serial masking rule, and a
 * second endpoint doing the same thing is a second place for those rules to
 * drift apart.
 */
export function AssetDetail({ tokenId }: { tokenId: number }) {
  const { session, orgId, role, gate } = useConsoleScreen();

  const load = React.useCallback(async () => {
    if (orgId === null) throw new Error("No organisation");
    const [list, metadata] = await Promise.all([
      listAssets(orgId),
      // Metadata is public and optional: an asset minted straight against the
      // contract has no off-chain row, so a 404 here is a fact about the asset,
      // not a failure of the screen.
      getAssetMetadata(tokenId).catch(() => null),
    ]);
    return {
      asset: list.assets.find((a) => a.tokenId === tokenId) ?? null,
      metadata,
    };
  }, [orgId, tokenId]);

  const resource = useResource(gate === null && orgId !== null ? load : null);

  const backLink = (
    <Link
      href="/dashboard/assets"
      className="font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
    >
      ← Back to the vault
    </Link>
  );

  if (gate) {
    return (
      <div>
        <p className="mb-4">{backLink}</p>
        {gate}
      </div>
    );
  }
  if (!session) return null;

  if (resource.status === "loading" && !resource.data) {
    return (
      <div>
        <p className="mb-4">{backLink}</p>
        <LoadingPanel label={`Loading certificate ${tokenId}`} rows={5} />
      </div>
    );
  }

  if (resource.status === "error") {
    return (
      <div>
        <p className="mb-4">{backLink}</p>
        <ApiErrorPanel
          error={resource.error}
          permission="membership of this organisation"
          role={role}
          onRetry={resource.reload}
        />
      </div>
    );
  }

  const asset = resource.data?.asset ?? null;
  const metadata = resource.data?.metadata ?? null;

  if (!asset) {
    return (
      <div>
        <p className="mb-4">{backLink}</p>
        <StatePanel title={`No certificate #${tokenId} here`} glyph="empty" tone="warn">
          <p>
            Token #{tokenId} is not held by organisation #{orgId}. Either it was
            never minted, or it belongs to a different organisation — in which
            case the vault of that organisation is the only place it appears.
          </p>
        </StatePanel>
      </div>
    );
  }

  const serialMasked = role !== "ADMIN" && role !== "MANAGER";

  return (
    <div>
      <p className="mb-4">{backLink}</p>

      <ScreenHeader kicker={`Certificate #${asset.tokenId}`} title={asset.name}>
        {asset.description ??
          `${asset.assetType} recorded on ${CHAIN.name}. The holder proves custody; the organisation retains control.`}
      </ScreenHeader>

      <p className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone="brand">{asset.assetType}</Badge>
        {asset.department ? <Badge tone="neutral">{asset.department}</Badge> : null}
        {asset.active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="warn">Revoked</Badge>
        )}
        <Badge tone="neutral" mono>
          ERC-721
        </Badge>
      </p>

      {isDisplayableAssetImage(asset.imageUrl) ? (
        <GlassCard padding="md" className="mb-4">
          <div className="relative h-56 overflow-hidden rounded-md bg-surface-2 sm:h-80">
            <Image
              src={asset.imageUrl}
              alt={`Photograph of ${asset.name}`}
              fill
              sizes="(min-width: 1024px) 52rem, 100vw"
              className="object-contain"
            />
          </div>
        </GlassCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Provenance ────────────────────────────────────────────── */}
        <GlassCard padding="md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="label-xs text-ink-faint">Provenance</h2>
            <Badge tone="brand">From the chain</Badge>
          </div>

          <div className="mb-4 flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
            <Identicon value={asset.assignedTo} size={38} />
            <div className="min-w-0">
              <p className="label-xs mb-1 text-ink-faint">Current holder</p>
              <MonoValue
                value={asset.assignedTo}
                label="holder address"
                href={explorerAddressUrl(asset.assignedTo)}
              />
            </div>
          </div>

          <dl className="flex flex-col">
            <Row label="Minted">
              {new Date(asset.mintedAt * 1000).toLocaleString()}
            </Row>
            <Row label="Reassignments">
              <span className="font-mono text-xs text-ink">
                {asset.transferCount}
              </span>
              <span className="ms-2 text-xs text-ink-faint">
                {asset.transferCount === 0
                  ? "still with its first holder"
                  : "organisation-controlled moves"}
              </span>
            </Row>
            <Row label="Token owner">
              <MonoValue
                value={asset.owner}
                label="owner address"
                href={explorerAddressUrl(asset.owner)}
              />
            </Row>
            <Row label="Organisation">
              <span className="font-mono text-xs text-ink">#{asset.orgId}</span>
            </Row>
            <Row label="Serial number">
              <span className="font-mono text-xs text-ink">
                {asset.serialNumber ?? "Not recorded"}
              </span>
              {serialMasked && asset.serialNumber ? (
                <span className="ms-2 text-xs text-ink-faint">
                  masked — needs Admin or Manager
                </span>
              ) : null}
            </Row>
          </dl>

          {asset.owner.toLowerCase() !== asset.assignedTo.toLowerCase() ? (
            <p className="mt-4 border-t border-border-soft pt-3 text-xs leading-relaxed text-warn">
              The token owner and the assigned holder differ. That happens after a
              revocation, when custody returns to the organisation&apos;s root
              admin while the record still names who last held it.
            </p>
          ) : null}
        </GlassCard>

        {/* ── Integrity ─────────────────────────────────────────────── */}
        <GlassCard padding="md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="label-xs text-ink-faint">Integrity check</h2>
            {asset.recordIntact === null ? (
              <Badge tone="neutral">Nothing to compare</Badge>
            ) : asset.recordIntact ? (
              <VerificationBadge state="verified" withHint />
            ) : (
              <VerificationBadge state="tampered" withHint />
            )}
          </div>

          <p className="mb-4 text-sm leading-relaxed text-ink-muted">
            The confidential record — serial number, invoice reference,
            department — is re-hashed and compared against the anchor written when
            the certificate was minted. A match proves the record has not been
            altered since; a mismatch proves it has.
          </p>

          <dl className="flex flex-col">
            <Row label="On-chain anchor">
              <MonoValue value={asset.assetHash} label="asset hash" head={12} tail={10} />
            </Row>
            <Row label="Off-chain record">
              {asset.hasOffChainRecord ? (
                asset.recordIntact ? (
                  <span className="text-xs text-success">
                    Present, and it re-hashes to the anchor
                  </span>
                ) : (
                  <span className="text-xs text-danger">
                    Present, but it no longer re-hashes to the anchor
                  </span>
                )
              ) : (
                <span className="text-xs text-ink-muted">
                  None. This token was minted without a record in the store.
                </span>
              )}
            </Row>
          </dl>

          {asset.recordIntact === false ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-danger/45 bg-danger/10 p-3 text-xs leading-relaxed text-ink"
            >
              Somebody changed the stored details after minting. The chain still
              holds the original hash, so the change is provable — but it cannot
              be undone from here, and the record should be treated as unreliable
              until an admin re-anchors it.
            </p>
          ) : null}

          <p className="mt-4 border-t border-border-soft pt-3 text-xs leading-relaxed text-ink-faint">
            Note what the chain does not hold: no serial number, no invoice, no
            holder name. Only the fingerprint.
          </p>
        </GlassCard>
      </div>

      {/* ── Transfer lock ───────────────────────────────────────────── */}
      <GlassCard padding="md" className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="label-xs text-ink-faint">Custody, not ownership</h2>
          <Badge tone="accent" mono>
            transferFrom reverts
          </Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <p className="text-sm leading-relaxed text-ink-muted">
            This certificate is <span className="font-semibold text-ink">non-transferable</span>.
            Calling <code className="font-mono text-ink">transferFrom</code> or{" "}
            <code className="font-mono text-ink">safeTransferFrom</code> reverts with{" "}
            <code className="font-mono text-ink">TransfersLocked</code>, and so does
            an approved operator, including one approved for all. The holder proves
            custody of the asset and cannot sell it.
          </p>
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="label-xs mb-2 text-ink-faint">Why it is built this way</p>
            <p className="text-xs leading-relaxed text-ink-muted">
              A company laptop is not a collectible. Only the three
              permission-gated functions —{" "}
              <code className="font-mono">reassignAsset</code>,{" "}
              <code className="font-mono">revokeAsset</code>,{" "}
              <code className="font-mono">restoreAsset</code> — can move it, and
              each needs{" "}
              <code className="font-mono text-ink">TRANSFER_ASSETS</code>. This is
              a design property, not a missing feature.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* ── Public metadata ────────────────────────────────────────── */}
      <MetadataPanel tokenId={asset.tokenId} metadata={metadata} asset={asset} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MetadataPanel({
  tokenId,
  metadata,
  asset,
}: {
  tokenId: number;
  metadata: AssetMetadata | null;
  asset: AssetSummary;
}) {
  return (
    <GlassCard padding="md" className="mt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="label-xs text-ink-faint">Public metadata</h2>
        <Badge tone="neutral">Anyone can read this</Badge>
      </div>

      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
        This is what a wallet or block explorer sees at{" "}
        <code className="font-mono text-ink">tokenURI</code>. It carries display
        detail and the integrity anchor, and deliberately carries no serial
        number, invoice reference or personal detail.
      </p>

      {metadata ? (
        <>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {metadata.attributes.map((attribute) => (
              <div
                key={`${attribute.trait_type}-${attribute.value}`}
                className="flex items-baseline justify-between gap-3 border-b border-border-soft py-2"
              >
                <dt className="label-xs text-ink-faint">{attribute.trait_type}</dt>
                <dd className="text-xs text-ink">{String(attribute.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
            <span className="label-xs">Schema</span>
            <code className="font-mono text-ink">{metadata.ownex.schema}</code>
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">
          No metadata document exists for this token. That happens when a token
          was minted against the contract without a matching record in the store —
          the certificate is still valid on-chain, it just has nothing to display.
        </p>
      )}

      <p className="mt-4 border-t border-border-soft pt-3">
        <a
          href={`/api/metadata/${tokenId}`}
          target="_blank"
          rel="noreferrer noopener"
          className="font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
        >
          View the raw JSON
        </a>
        {asset.metadataUri ? (
          <span className="ms-3 text-xs break-all text-ink-faint">
            {asset.metadataUri}
          </span>
        ) : null}
      </p>
    </GlassCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-soft py-2.5 last:border-0">
      <dt className="label-xs shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}
