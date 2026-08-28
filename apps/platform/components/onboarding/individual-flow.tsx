"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { saveProfile, type ProfileSaveResult } from "@/lib/api";
import { identityRegistry } from "@/lib/contracts";
import { useWallet } from "@/components/wallet/wallet-provider";
import { Badge, Button, GlassCard, Input } from "@/components/ui";
import { MonoValue } from "@/components/console/copy-field";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";

/**
 * Creating an identity.
 *
 * The order is the whole point and is worth watching: the details are saved
 * encrypted first, the server returns their hash, and only the hash is signed.
 * Nothing typed into this form is ever sent to the chain — which is why the form
 * can ask for an email at all.
 *
 * Registration is self-service by design. `registerIdentity` lets any wallet
 * register itself, so nobody needs an administrator's permission to exist. What
 * needs permission is being given a role.
 */
export function IndividualFlow() {
  const { session } = useWallet();
  const router = useRouter();
  const [displayName, setName] = React.useState(session?.profile?.displayName ?? "");
  const [jobTitle, setJobTitle] = React.useState(session?.profile?.jobTitle ?? "");
  const [department, setDepartment] = React.useState(session?.profile?.department ?? "");
  const [email, setEmail] = React.useState("");

  const tx = useTransaction<ProfileSaveResult>();

  const nameValid = displayName.trim().length >= 2;
  const emailValid = email === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const ready = nameValid && emailValid;

  const submit = () =>
    tx.run({
      prepare: () =>
        saveProfile({
          displayName: displayName.trim(),
          jobTitle: jobTitle.trim() || undefined,
          department: department.trim() || undefined,
          email: email.trim() || undefined,
        }),
      send: ({ signer, prepared }) => {
        const registry = identityRegistry(signer);
        // The server says which call applies, because only the chain knows
        // whether this wallet has an identity already.
        return prepared.nextStep?.call === "updateIdentityHash"
          ? registry.updateIdentityHash(prepared.identityHash)
          : registry.registerIdentity(prepared.identityHash);
      },
    });

  if (tx.stage === "done") {
    return (
      <GlassCard padding="lg" role="status" className="border-success/45">
        <Badge tone="success" className="mb-4">
          Identity anchored
        </Badge>
        <h2 className="display-sm mb-2 text-xl font-semibold text-ink">
          You exist on {""}
          <span className="whitespace-nowrap">the registry</span>
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-ink-muted">
          Your record is encrypted in the store and its fingerprint is on the
          chain. Nobody can alter the record without the mismatch becoming
          provable — including us.
        </p>
        <p className="mb-5 rounded-md border border-border bg-surface-2 p-3 text-sm leading-relaxed text-ink-muted">
          The next step is not yours. An admin adds you to their organisation by
          wallet address; there is no request to send and no invite to accept.
          Give them this address:
        </p>
        {session ? (
          <p className="mb-5">
            <MonoValue value={session.wallet} label="your wallet address" head={14} tail={10} />
          </p>
        ) : null}
        <TransactionRail stage={tx.stage} txHash={tx.txHash} className="mb-5" />
        <Button variant="primary" onClick={() => router.push("/dashboard")}>
          Open the console
        </Button>
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GlassCard padding="md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="label-xs text-ink-faint">Your details</h2>
          <Badge tone="neutral">Encrypted, never on-chain</Badge>
        </div>

        <div className="flex flex-col gap-4">
          <Input
            label="Display name"
            placeholder="Arjun Mehta"
            value={displayName}
            onChange={(event) => setName(event.target.value)}
            disabled={tx.busy}
            error={displayName && !nameValid ? "At least two characters" : undefined}
          />
          <Input
            label="Job title"
            placeholder="Software Engineer"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            disabled={tx.busy}
          />
          <Input
            label="Department"
            placeholder="Engineering"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            disabled={tx.busy}
          />
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={tx.busy}
            error={emailValid ? undefined : "That does not look like an email address"}
            hint="Encrypted with AES-256-GCM. Only you ever see it in full; everywhere else it is masked."
          />
        </div>
      </GlassCard>

      <GlassCard padding="md">
        <h2 className="label-xs mb-3 text-ink-faint">What the chain gets</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          One 32-byte hash of everything above, and nothing else. No name, no
          email, no department. A verifier can later prove the record was not
          altered without ever being shown it — that is the entire trick, and it is
          why this form is safe to fill in.
        </p>
      </GlassCard>

      <TransactionFailure failure={tx.failure} />
      <TransactionRail stage={tx.stage} txHash={tx.txHash} />
      <TransactionDismissed failure={tx.failure} />

      <div>
        <Button
          variant="primary"
          onClick={submit}
          loading={tx.busy}
          disabled={!ready}
        >
          {tx.stage === "error" ? "Try again" : "Save and anchor"}
        </Button>
        <p className="mt-2 text-xs text-ink-faint">
          One signature. It costs gas on a real network, which is why it happens
          once rather than on every edit.
        </p>
      </div>
    </div>
  );
}
