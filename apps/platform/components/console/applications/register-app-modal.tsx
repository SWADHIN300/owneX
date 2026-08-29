"use client";

import * as React from "react";

import { createAppDraft, type AppDraftResult } from "@/lib/api";
import { orgAccessManager } from "@/lib/contracts";
import { Button, Input, Modal } from "@/components/ui";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";

/**
 * Registering an application.
 *
 * The slug is the important field: `keccak256(slug)` is the on-chain key, so it
 * is what every later access check consults. Changing it later means registering
 * a different application, which is why it is validated tightly and explained
 * rather than treated as a display detail.
 *
 * Registration grants nobody anything on its own — access is a separate
 * transaction per role. That separation is deliberate: it means an application can
 * exist, be inspected, and be given access deliberately rather than by default.
 */
export function RegisterAppModal({
  orgId,
  onClose,
  onDone,
}: {
  orgId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const tx = useTransaction<AppDraftResult>();

  const slugValid = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug);
  const nameValid = name.trim().length >= 2;
  const urlValid = /^https?:\/\/.+/.test(url.trim());
  const ready = slugValid && nameValid && urlValid;

  const close = () => {
    if (tx.busy) return;
    if (tx.stage === "done") onDone();
    onClose();
    tx.reset();
  };

  const submit = () =>
    tx.run({
      prepare: () =>
        createAppDraft({
          orgId,
          slug,
          name: name.trim(),
          url: url.trim(),
          description: description.trim() || undefined,
        }),
      send: ({ signer, prepared }) =>
        orgAccessManager(signer).registerApplication(
          prepared.registerArgs.orgId,
          prepared.registerArgs.appId,
          prepared.registerArgs.metadataHash,
        ),
    });

  return (
    <Modal
      open
      onClose={close}
      title="Register an application"
      description="Gives the application a key on-chain. Access for each role is granted separately, so nothing is allowed by registering."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={tx.busy}>
            {tx.stage === "done" ? "Close" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={tx.busy}
            disabled={!ready || tx.stage === "done"}
          >
            {tx.stage === "error" ? "Try again" : "Sign and register"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          placeholder="Employee Portal"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            // The slug follows the name until somebody edits it deliberately.
            if (!slug || slug === toSlug(name)) setSlug(toSlug(event.target.value));
          }}
          disabled={tx.busy || tx.stage === "done"}
          error={name && !nameValid ? "At least two characters" : undefined}
        />
        <Input
          label="Slug"
          placeholder="employee-portal"
          mono
          value={slug}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
          disabled={tx.busy || tx.stage === "done"}
          error={slug && !slugValid ? "Lowercase letters, digits and hyphens" : undefined}
          hint={
            slugValid || !slug
              ? "keccak256 of this is the on-chain key. Changing it later registers a different application."
              : undefined
          }
        />
        <Input
          label="URL"
          placeholder="https://ownex-employee-portal.vercel.app"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={tx.busy || tx.stage === "done"}
          error={url && !urlValid ? "Needs to be an http or https URL" : undefined}
        />
        <Input
          label="Description"
          placeholder="Where staff see their assigned equipment"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={tx.busy || tx.stage === "done"}
        />

        <TransactionFailure failure={tx.failure} />
        <TransactionRail stage={tx.stage} txHash={tx.txHash} />
        <TransactionDismissed failure={tx.failure} />

        {tx.stage === "done" ? (
          <p role="status" className="text-xs leading-relaxed text-ink-muted">
            Registered. No role can reach it yet — grant access on the card once
            this closes.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
