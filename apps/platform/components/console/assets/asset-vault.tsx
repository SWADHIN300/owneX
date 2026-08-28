"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import { listAssets, type AssetSummary } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { Badge, Button, GlassCard, Select } from "@/components/ui";
import {
  ApiErrorPanel,
  EmptyPanel,
  LoadingPanel,
} from "@/components/console/states";
import {
  ScreenHeader,
  useConsoleScreen,
} from "@/components/console/use-console-screen";
import { CertificateCard } from "./certificate-card";
import { AssetTable } from "./asset-table";

/**
 * Asset Vault.
 *
 * Everything authoritative here — holder, active status, transfer count, the
 * hash — comes from the chain. Names, departments and photographs come from the
 * record store. When the two disagree the asset is flagged, and the flag is
 * never filtered out by default: a tampered record that only appears when you
 * go looking for it is not tamper-evidence.
 */

type StatusFilter = "all" | "active" | "revoked" | "tampered";
type View = "grid" | "table";

const ALL = "__all__";

export function AssetVault() {
  const { session, orgId, role, gate } = useConsoleScreen();
  const router = useRouter();

  const load = React.useCallback(
    () => (orgId === null ? Promise.reject(new Error("No organisation")) : listAssets(orgId)),
    [orgId],
  );
  const assets = useResource(gate === null && orgId !== null ? load : null);

  const [type, setType] = React.useState(ALL);
  const [department, setDepartment] = React.useState(ALL);
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [view, setView] = React.useState<View>("grid");

  // ADMIN and MANAGER see full serial numbers; the route masks them for
  // everybody else, so the interface should say so rather than showing dots
  // with no explanation.
  const serialMasked = role !== "ADMIN" && role !== "MANAGER";

  // Minting needs MINT_ASSETS, which by default only Admin holds. The action is
  // hidden rather than disabled for everybody else: an empty vault already
  // explains that an admin has to mint first, so a dead button would only repeat
  // it less clearly.
  const canMint = session?.permissions?.MINT_ASSETS ?? false;

  const mintAction = canMint ? (
    <Button variant="primary" onClick={() => router.push("/dashboard/assets/new")}>
      Mint a certificate
    </Button>
  ) : null;

  const header = (
    <ScreenHeader
      kicker="Asset vault"
      title="Asset certificates"
      actions={
        <>
          {assets.data && assets.data.assets.length > 0 ? (
            <ViewToggle view={view} onChange={setView} />
          ) : null}
          {mintAction}
        </>
      }
    >
      Each certificate is an ERC-721 token whose holder proves custody. Transfers
      are locked to the organisation, so nothing here can be sold or moved
      wallet-to-wallet.
    </ScreenHeader>
  );

  if (gate) return <div>{header}{gate}</div>;
  if (!session) return null;

  if (assets.status === "loading" && !assets.data) {
    return (
      <div>
        {header}
        <LoadingPanel label="Loading asset certificates" shape="cards" rows={3} />
      </div>
    );
  }

  if (assets.status === "error") {
    return (
      <div>
        {header}
        <ApiErrorPanel
          error={assets.error}
          permission="membership of this organisation"
          role={role}
          onRetry={assets.reload}
        />
      </div>
    );
  }

  const list = assets.data;
  if (!list) return <div>{header}</div>;

  if (list.assets.length === 0 && list.pending.length === 0) {
    return (
      <div>
        {header}
        <EmptyPanel
          title="Nothing has been minted yet"
          action={mintAction ?? undefined}
        >
          <p>
            Certificates appear here once an admin mints one and assigns it to a
            wallet. Nobody gets an asset by signing up, and there is no way to
            claim one — minting needs the{" "}
            <code className="font-mono text-ink">MINT_ASSETS</code> permission,
            which by default only Admin holds.
          </p>
        </EmptyPanel>
      </div>
    );
  }

  const types = uniqueValues(list.assets.map((a) => a.assetType));
  const departments = uniqueValues(list.assets.map((a) => a.department));

  const filtered = list.assets.filter((asset) => {
    if (type !== ALL && asset.assetType !== type) return false;
    if (department !== ALL && (asset.department ?? "") !== department) return false;
    if (status === "active" && !asset.active) return false;
    if (status === "revoked" && asset.active) return false;
    if (status === "tampered" && asset.recordIntact !== false) return false;
    return true;
  });

  const tamperedCount = list.assets.filter((a) => a.recordIntact === false).length;
  const filtersApplied = type !== ALL || department !== ALL || status !== "all";

  return (
    <div>
      {header}

      {tamperedCount > 0 ? (
        <GlassCard
          padding="md"
          role="alert"
          className="mb-4 border-danger/50"
        >
          <p className="text-sm leading-relaxed text-ink">
            {tamperedCount === 1
              ? "One record no longer matches its on-chain anchor."
              : `${tamperedCount} records no longer match their on-chain anchor.`}{" "}
            The stored details were changed after the certificate was minted. The
            chain still holds the original hash, so the change is detectable but
            not reversible from here.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              setStatus("tampered");
              setType(ALL);
              setDepartment(ALL);
            }}
          >
            Show only those
          </Button>
        </GlassCard>
      ) : null}

      <GlassCard padding="sm" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Asset type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            options={[
              { value: ALL, label: `All types (${list.assets.length})` },
              ...types.map((value) => ({ value, label: value })),
            ]}
          />
          <Select
            label="Department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            options={[
              { value: ALL, label: "All departments" },
              ...departments.map((value) => ({ value, label: value })),
            ]}
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            options={[
              { value: "all", label: "Any status" },
              { value: "active", label: "Active only" },
              { value: "revoked", label: "Revoked only" },
              {
                value: "tampered",
                label: `Hash mismatch${tamperedCount > 0 ? ` (${tamperedCount})` : ""}`,
              },
            ]}
          />
        </div>

        <p
          role="status"
          aria-live="polite"
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-soft pt-3 text-xs text-ink-faint"
        >
          Showing {filtered.length} of {list.assets.length}
          {serialMasked ? (
            <Badge tone="neutral">Serial numbers masked for your role</Badge>
          ) : null}
          {filtersApplied ? (
            <button
              type="button"
              onClick={() => {
                setType(ALL);
                setDepartment(ALL);
                setStatus("all");
              }}
              className="text-accent underline"
            >
              Clear filters
            </button>
          ) : null}
        </p>
      </GlassCard>

      {filtered.length === 0 ? (
        <GlassCard padding="lg" role="status" className="text-center">
          <h2 className="display-sm mb-2 text-lg font-semibold text-ink">
            No certificate matches those filters
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-muted">
            The organisation holds {list.assets.length}{" "}
            {list.assets.length === 1 ? "certificate" : "certificates"}; none of
            them fit the current combination.
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => {
              setType(ALL);
              setDepartment(ALL);
              setStatus("all");
            }}
          >
            Clear filters
          </Button>
        </GlassCard>
      ) : view === "grid" ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((asset) => (
            <li key={asset.tokenId} className="flex">
              <CertificateCard asset={asset} serialMasked={serialMasked} />
            </li>
          ))}
        </ul>
      ) : (
        <AssetTable assets={filtered} />
      )}

      {list.pending.length > 0 ? (
        <GlassCard padding="md" className="mt-4 border-warn/45">
          <h2 className="label-xs mb-3 text-ink-faint">
            Drafts waiting to be minted
          </h2>
          <p className="mb-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
            These records exist off-chain and have an anchor computed, but no
            token is bound to them yet — the mint transaction was never confirmed.
            They are not certificates until it is.
          </p>
          <ul className="flex flex-col gap-2">
            {list.pending.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm text-ink">{draft.name}</span>
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{draft.assetType}</Badge>
                  <Badge tone="warn">Not minted</Badge>
                </span>
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ViewToggle({
  view,
  onChange,
}: {
  view: View;
  onChange: (next: View) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="inline-flex rounded-md border border-border bg-surface p-0.5"
    >
      {(["grid", "table"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-sm px-3 py-1.5 font-mono text-[0.6875rem] font-semibold tracking-[0.1em] uppercase transition-colors duration-200",
            view === option
              ? "bg-brand text-brand-ink"
              : "text-ink-muted hover:bg-brand-soft hover:text-ink",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function uniqueValues(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}

export type { AssetSummary };
