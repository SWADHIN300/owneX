"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Interface } from "ethers";

import {
  ASSET_TYPES,
  confirmAsset,
  createAssetDraft,
  listMembers,
  type AssetDraftResult,
  type AssetType,
} from "@/lib/api";
import { ADDRESSES, ASSET_NFT_ABI, assetNFT } from "@/lib/contracts";
import { shortAddress } from "@/lib/wallet";
import { useResource } from "@/lib/use-resource";
import {
  Badge,
  Button,
  GlassCard,
  Identicon,
  Input,
  Select,
} from "@/components/ui";
import { ApiErrorPanel, DeniedPanel, LoadingPanel } from "@/components/console/states";
import {
  ScreenHeader,
  useConsoleScreen,
} from "@/components/console/use-console-screen";
import { MonoValue } from "@/components/console/copy-field";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";

/**
 * Mint a certificate.
 *
 * Laid out as the split it is, because the split is the whole privacy argument
 * and a single form would hide it: the left column is the confidential record
 * that stays encrypted in the store, the right column is the four values the
 * chain will hold. A serial number is on the left. Its fingerprint is on the
 * right. Nothing crosses.
 *
 * The order matters too. The record is saved first and the hash comes back from
 * the server, so the value being anchored is the one the server will later
 * re-hash to verify — not one the client computed and hoped matched.
 */

interface Draft {
  name: string;
  assetType: AssetType;
  description: string;
  department: string;
  imageUrl: string;
  serialNumber: string;
  invoiceReference: string;
  assignedTo: string;
}

const EMPTY: Draft = {
  name: "",
  assetType: "Laptop",
  description: "",
  department: "",
  imageUrl: "",
  serialNumber: "",
  invoiceReference: "",
  assignedTo: "",
};

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function MintWizard() {
  const { session, orgId, role, gate } = useConsoleScreen();
  const router = useRouter();

  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // The roster is needed as a picker: the contract reverts with
  // RecipientNotOrgMember for anybody outside the organisation, so offering a
  // free-text address alone would invite a failure that a list prevents.
  const loadMembers = React.useCallback(
    () => (orgId === null ? Promise.reject(new Error("No organisation")) : listMembers(orgId)),
    [orgId],
  );
  const members = useResource(gate === null && orgId !== null ? loadMembers : null);

  const canMint = session?.permissions?.MINT_ASSETS ?? false;

  const nameValid = draft.name.trim().length >= 2;
  const holderValid = ADDRESS.test(draft.assignedTo.trim());
  const imageValid = draft.imageUrl === "" || /^https?:\/\//.test(draft.imageUrl.trim());
  const ready = nameValid && holderValid && imageValid && orgId !== null;

  const tx = useTransaction<AssetDraftResult, { tokenId: number }>();

  const mint = () =>
    tx.run({
      prepare: () =>
        createAssetDraft({
          orgId: orgId as number,
          name: draft.name.trim(),
          assetType: draft.assetType,
          description: draft.description.trim() || undefined,
          department: draft.department.trim() || undefined,
          imageUrl: draft.imageUrl.trim() || undefined,
          serialNumber: draft.serialNumber.trim() || undefined,
          invoiceReference: draft.invoiceReference.trim() || undefined,
        }),
      send: ({ signer, prepared }) =>
        assetNFT(signer).mintAsset(
          prepared.mintArgs.orgId,
          draft.assignedTo.trim(),
          prepared.mintArgs.assetHash,
          prepared.mintArgs.metadataURI,
        ),
      record: async ({ prepared, receipt, txHash }) => {
        const tokenId = readMintedTokenId(receipt);
        if (tokenId === null) {
          throw new Error(
            "The mint transaction succeeded but no AssetMinted event was found in the receipt, so the record was left unbound.",
          );
        }
        await confirmAsset(prepared.assetId, { tokenId, txHash });
        return { tokenId };
      },
    });

  const header = (
    <ScreenHeader kicker="Mint a certificate" title="New asset certificate">
      Two records, one transaction. The confidential half is encrypted and stays
      in the store; the chain gets its fingerprint, the holder and where to find
      the public metadata.
    </ScreenHeader>
  );

  if (gate) return <div>{header}{gate}</div>;
  if (!session) return null;

  if (!canMint) {
    return (
      <div>
        {header}
        <DeniedPanel permission="MINT_ASSETS" role={role}>
          Minting a certificate needs the{" "}
          <code className="font-mono text-ink">MINT_ASSETS</code> permission,
          which by default only Admin holds. Nobody mints their own asset — that is
          the point of the permission.
        </DeniedPanel>
      </div>
    );
  }

  if (members.status === "loading" && !members.data) {
    return (
      <div>
        {header}
        <LoadingPanel label="Loading the member roster" rows={4} />
      </div>
    );
  }

  if (members.status === "error") {
    return (
      <div>
        {header}
        <ApiErrorPanel
          error={members.error}
          permission="membership of this organisation"
          role={role}
          onRetry={members.reload}
        />
      </div>
    );
  }

  const roster = (members.data?.members ?? []).filter((m) => m.role !== "NONE");

  /* ── Minted ────────────────────────────────────────────────────────── */
  if (tx.stage === "done" && tx.result) {
    return (
      <div>
        {header}
        <GlassCard padding="lg" role="status" className="border-success/45">
          <Badge tone="success" className="mb-4">
            Minted
          </Badge>
          <h2 className="display-sm mb-2 text-xl font-semibold text-ink">
            Certificate #{tx.result.tokenId} exists
          </h2>
          <p className="mb-5 max-w-xl text-sm leading-relaxed text-ink-muted">
            The token is on the chain and the encrypted record is bound to it. The
            server re-read the token and confirmed its on-chain hash matches the
            record before binding, so the integrity check on the certificate reads
            verified rather than merely assumed.
          </p>
          <TransactionRail stage={tx.stage} txHash={tx.txHash} className="mb-5 max-w-md" />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => router.push(`/dashboard/assets/${tx.result?.tokenId}`)}
            >
              Open the certificate
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY);
                tx.reset();
              }}
            >
              Mint another
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4">
        <Link
          href="/dashboard/assets"
          className="font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
        >
          ← Back to the vault
        </Link>
      </p>

      {header}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Off the chain ───────────────────────────────────────────── */}
        <GlassCard padding="md">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="label-xs text-ink-faint">Stays off the chain</h2>
            <Badge tone="neutral">Encrypted, AES-256-GCM</Badge>
          </div>

          <div className="flex flex-col gap-4">
            <Input
              label="Name"
              placeholder="Company Laptop 001"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              error={draft.name && !nameValid ? "At least two characters" : undefined}
            />
            <Select
              label="Asset type"
              value={draft.assetType}
              onChange={(e) => set("assetType", e.target.value as AssetType)}
              options={ASSET_TYPES.map((value) => ({ value, label: value }))}
            />
            <Input
              label="Description"
              placeholder="Company-issued laptop, Engineering department"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              hint="Shown in the public metadata, so keep it display-safe."
            />
            <Input
              label="Department"
              placeholder="Engineering"
              value={draft.department}
              onChange={(e) => set("department", e.target.value)}
            />
            <Input
              label="Serial number"
              placeholder="NW-LAP-4471"
              mono
              value={draft.serialNumber}
              onChange={(e) => set("serialNumber", e.target.value)}
              hint="Encrypted at rest and masked from anyone below Manager. Never written on-chain."
            />
            <Input
              label="Invoice reference"
              placeholder="INV-2026-0042"
              mono
              value={draft.invoiceReference}
              onChange={(e) => set("invoiceReference", e.target.value)}
              hint="Hashed into the anchor, never published."
            />
            <Input
              label="Photograph URL"
              placeholder="https://…"
              value={draft.imageUrl}
              onChange={(e) => set("imageUrl", e.target.value)}
              error={imageValid ? undefined : "Needs to be an http or https URL"}
              hint="Optional. A certificate with no photograph gets a face drawn from its anchor."
            />
          </div>
        </GlassCard>

        {/* ── On the chain ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <GlassCard padding="md">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="label-xs text-ink-faint">Goes on the chain</h2>
              <Badge tone="brand">Public and permanent</Badge>
            </div>

            <div className="mb-4">
              <Select
                label="Assign to"
                value={draft.assignedTo}
                onChange={(e) => set("assignedTo", e.target.value)}
                placeholder="Choose a member"
                options={roster.map((m) => ({
                  value: m.wallet,
                  label: `${m.profile?.displayName ?? shortAddress(m.wallet)} — ${m.role}`,
                }))}
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                Only members can hold a certificate. The contract reverts with{" "}
                <code className="font-mono">RecipientNotOrgMember</code> for
                anybody else.
              </p>
            </div>

            {holderValid ? (
              <div className="mb-4 flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
                <Identicon value={draft.assignedTo} size={34} />
                <MonoValue value={draft.assignedTo} label="holder address" />
              </div>
            ) : null}

            <dl className="flex flex-col">
              <Row label="Organisation">
                <span className="font-mono text-xs text-ink">#{orgId}</span>
              </Row>
              <Row label="Asset hash">
                <span className="text-xs text-ink-muted">
                  keccak256 of the record on the left, computed by the server when
                  you mint
                </span>
              </Row>
              <Row label="Metadata URI">
                <span className="text-xs text-ink-muted">
                  /api/metadata/&lt;token id&gt;
                </span>
              </Row>
              <Row label="Transferable">
                <Badge tone="warn">No — locked to the organisation</Badge>
              </Row>
            </dl>

            <p className="mt-4 border-t border-border-soft pt-3 text-xs leading-relaxed text-ink-faint">
              Four values, and not one of them is personal. That is what makes the
              chain safe to publish: a verifier can prove the record is unaltered
              without ever seeing it.
            </p>
          </GlassCard>

          <GlassCard padding="md">
            <TransactionFailure failure={tx.failure} />
            <TransactionRail stage={tx.stage} txHash={tx.txHash} />

            {tx.stage === "idle" || tx.stage === "error" ? (
              <>
                <Button
                  variant="primary"
                  fullWidth
                  disabled={!ready}
                  loading={tx.busy}
                  onClick={mint}
                  className={tx.failure ? "mt-3" : undefined}
                >
                  {tx.stage === "error" ? "Try again" : "Save record and mint"}
                </Button>
                <TransactionDismissed failure={tx.failure} />
                {!ready ? (
                  <p className="mt-2 text-xs text-ink-faint">
                    {!nameValid
                      ? "A name is needed."
                      : !holderValid
                        ? "Choose who will hold the certificate."
                        : "Fix the photograph URL."}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-ink-faint">
                    One signature. The record is saved first so the hash you sign is
                    the one the server will re-check later.
                  </p>
                )}
              </>
            ) : null}
          </GlassCard>
        </div>
      </div>
    </div>
  );

  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-soft py-2.5 last:border-0">
        <dt className="label-xs shrink-0 text-ink-faint">{label}</dt>
        <dd className="min-w-0 text-end">{children}</dd>
      </div>
    );
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The token id, read from the event the transaction emitted.
 *
 * Not derived from `totalMinted + 1`: two mints landing in the same block would
 * make that wrong, and the record would then be bound to somebody else's token.
 * The confirm endpoint refuses a mismatched binding, but only because it checks —
 * relying on that as the safety net rather than the second line of defence would
 * be careless.
 *
 * Only logs emitted by AssetNFT itself are considered. A smart-account or
 * delegation transaction carries dozens of logs from other contracts, and a
 * matching topic signature elsewhere in that pile would otherwise be read as a
 * mint.
 */
function readMintedTokenId(
  receipt: { logs?: readonly unknown[] } | null,
): number | null {
  if (!receipt?.logs) return null;
  const iface = new Interface(ASSET_NFT_ABI);
  const assetNFTAddress = ADDRESSES.assetNFT.toLowerCase();

  for (const log of receipt.logs) {
    const entry = log as { address?: string; topics: readonly string[]; data: string };
    if (assetNFTAddress && entry.address && entry.address.toLowerCase() !== assetNFTAddress) continue;

    try {
      const parsed = iface.parseLog(entry);
      if (parsed?.name === "AssetMinted") return Number(parsed.args[0]);
    } catch {
      // Logs from other contracts in the same transaction will not parse.
      // Skipping them is expected, not an error.
    }
  }
  return null;
}
