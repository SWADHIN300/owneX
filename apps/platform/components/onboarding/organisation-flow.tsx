"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Interface } from "ethers";

import {
  confirmOrganisation,
  prepareOrganisation,
  saveProfile,
  type OrgPrepareResult,
  type ProfileSaveResult,
} from "@/lib/api";
import { IDENTITY_REGISTRY_ABI, identityRegistry } from "@/lib/contracts";
import { useWallet } from "@/components/wallet/wallet-provider";
import { Badge, Button, GlassCard, Input } from "@/components/ui";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";

/**
 * Setting up an organisation.
 *
 * Two signatures, and they are deliberately not merged. The identity has to exist
 * first: `effectiveRole` returns NONE for a wallet with no active identity, so an
 * organisation created by an unregistered wallet would have a root admin who
 * resolves to no admin — an organisation nobody could ever govern.
 *
 * Being honest about the two steps also means a failure between them is
 * recoverable. The identity survives, and only the second signature is retried.
 */
export function OrganisationFlow() {
  const { session, refresh } = useWallet();
  const router = useRouter();

  const [displayName, setDisplayName] = React.useState(
    session?.profile?.displayName ?? "",
  );
  const [orgName, setOrgName] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [website, setWebsite] = React.useState("");

  const identityDone = session?.identity.registered ?? false;

  const identityTx = useTransaction<ProfileSaveResult>();
  const orgTx = useTransaction<OrgPrepareResult, { orgId: number }>();

  const nameValid = displayName.trim().length >= 2;
  const orgValid = orgName.trim().length >= 2;
  const websiteValid = website === "" || /^https?:\/\/.+/.test(website.trim());

  const anchorIdentity = () =>
    identityTx.run({
      prepare: () => saveProfile({ displayName: displayName.trim() }),
      send: ({ signer, prepared }) => {
        const registry = identityRegistry(signer);
        return prepared.nextStep?.call === "updateIdentityHash"
          ? registry.updateIdentityHash(prepared.identityHash)
          : registry.registerIdentity(prepared.identityHash);
      },
      record: async () => {
        // The second step is gated on the identity existing, so the session has
        // to be re-read before it becomes available.
        await refresh().catch(() => null);
      },
    });

  const createOrg = () =>
    orgTx.run({
      prepare: () =>
        prepareOrganisation({
          name: orgName.trim(),
          industry: industry.trim() || undefined,
          website: website.trim() || undefined,
        }),
      send: ({ signer, prepared }) =>
        identityRegistry(signer).createOrganization(prepared.createArgs.metadataHash),
      record: async ({ receipt, txHash }) => {
        const orgId = readCreatedOrgId(receipt);
        if (orgId === null) {
          throw new Error(
            "The organisation was created but no OrganizationCreated event was found in the receipt, so its record could not be bound.",
          );
        }
        await confirmOrganisation({
          orgId,
          txHash,
          name: orgName.trim(),
          industry: industry.trim() || undefined,
          website: website.trim() || undefined,
        });
        return { orgId };
      },
    });

  const stepOneComplete = identityDone || identityTx.stage === "done";

  if (orgTx.stage === "done" && orgTx.result) {
    return (
      <GlassCard padding="lg" role="status" className="border-success/45">
        <Badge tone="success" className="mb-4">
          Organisation #{orgTx.result.orgId} created
        </Badge>
        <h2 className="display-sm mb-2 text-xl font-semibold text-ink">
          {orgName} exists
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-ink-muted">
          You are its root admin. That seat cannot be taken from you by a role
          change — it moves only through an explicit transfer — which is what stops
          an organisation being locked out of itself.
        </p>
        <p className="mb-5 rounded-md border border-border bg-surface-2 p-3 text-sm leading-relaxed text-ink-muted">
          The permission matrix already works with no configuration. Add members by
          wallet address, and mint certificates when you are ready.
        </p>
        <TransactionRail stage={orgTx.stage} txHash={orgTx.txHash} className="mb-5" />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => router.push("/dashboard/members")}
          >
            Add your first member
          </Button>
          <Button
            variant="secondary"
            onClick={() => router.push("/dashboard")}
          >
            Open the console
          </Button>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Step one ─────────────────────────────────────────────────── */}
      <GlassCard padding="md" className={stepOneComplete ? "border-success/45" : undefined}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="label-xs text-ink-faint">Step one — your identity</h2>
          {stepOneComplete ? (
            <Badge tone="success">Done</Badge>
          ) : (
            <Badge tone="neutral">Required first</Badge>
          )}
        </div>

        {stepOneComplete ? (
          <p className="text-sm leading-relaxed text-ink-muted">
            This wallet holds an active identity, so it can be an organisation&apos;s
            root admin.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm leading-relaxed text-ink-muted">
              An organisation needs a root admin with a live identity. Without one
              the seat would resolve to no admin at all, and nobody could ever
              govern it.
            </p>
            <Input
              label="Your name"
              placeholder="Priya Sharma"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={identityTx.busy}
              error={displayName && !nameValid ? "At least two characters" : undefined}
              hint="Encrypted at rest. Only its hash goes on-chain."
            />

            <div className="mt-4 flex flex-col gap-3">
              <TransactionFailure failure={identityTx.failure} />
              <TransactionRail stage={identityTx.stage} txHash={identityTx.txHash} />
              <TransactionDismissed failure={identityTx.failure} />
              <div>
                <Button
                  variant="primary"
                  onClick={anchorIdentity}
                  loading={identityTx.busy}
                  disabled={!nameValid}
                >
                  {identityTx.stage === "error" ? "Try again" : "Anchor my identity"}
                </Button>
              </div>
            </div>
          </>
        )}
      </GlassCard>

      {/* ── Step two ─────────────────────────────────────────────────── */}
      <GlassCard padding="md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="label-xs text-ink-faint">Step two — the organisation</h2>
          <Badge tone={stepOneComplete ? "brand" : "neutral"}>
            {stepOneComplete ? "Ready" : "Waiting on step one"}
          </Badge>
        </div>

        <fieldset disabled={!stepOneComplete || orgTx.busy} className="flex flex-col gap-4">
          <Input
            label="Organisation name"
            placeholder="Northwind Industries"
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            error={orgName && !orgValid ? "At least two characters" : undefined}
          />
          <Input
            label="Industry"
            placeholder="Manufacturing"
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
          />
          <Input
            label="Website"
            placeholder="https://example.com"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            error={websiteValid ? undefined : "Needs to be an http or https URL"}
          />
        </fieldset>

        <div className="mt-4 flex flex-col gap-3">
          <TransactionFailure failure={orgTx.failure} />
          <TransactionRail stage={orgTx.stage} txHash={orgTx.txHash} />
          <TransactionDismissed failure={orgTx.failure} />
          <div>
            <Button
              variant="primary"
              onClick={createOrg}
              loading={orgTx.busy}
              disabled={!stepOneComplete || !orgValid || !websiteValid}
            >
              {orgTx.stage === "error" ? "Try again" : "Create the organisation"}
            </Button>
            <p className="mt-2 text-xs text-ink-faint">
              You become root admin. The four roles and their default permissions
              work immediately with nothing to configure.
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The organisation id, read from the event rather than from
 * `organizationCount()`. Two organisations created in the same block would make
 * the count wrong, and the confirm endpoint would then be handed somebody else's
 * id — which it rejects, because it checks the root admin and the hash.
 */
function readCreatedOrgId(receipt: { logs?: readonly unknown[] } | null): number | null {
  if (!receipt?.logs) return null;
  const iface = new Interface(IDENTITY_REGISTRY_ABI);

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log as { topics: readonly string[]; data: string });
      if (parsed?.name === "OrganizationCreated") return Number(parsed.args[0]);
    } catch {
      // Logs from other contracts will not parse. Expected, not an error.
    }
  }
  return null;
}
