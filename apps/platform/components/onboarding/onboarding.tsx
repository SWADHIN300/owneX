"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CHAIN } from "@/lib/wallet";
import { useWallet } from "@/components/wallet/wallet-provider";
import { Badge, Button, GlassCard, Skeleton, SkeletonLabel } from "@/components/ui";
import { IndividualFlow } from "./individual-flow";
import { OrganisationFlow } from "./organisation-flow";

/**
 * Onboarding.
 *
 * Two paths, because there are genuinely two situations and pretending otherwise
 * is where most of these flows go wrong:
 *
 *   an individual  joining an organisation somebody else runs. They need an
 *                  identity, and then an admin adds them. They cannot add
 *                  themselves, and saying so early avoids a dead end later
 *
 *   an organisation someone setting one up. They need an identity first, because
 *                  an organisation whose root admin has no identity would resolve
 *                  to no admin at all
 *
 * Both paths share the first step for that reason, and the fork exists to set the
 * expectation, not to change the mechanics.
 */
type Path = "choose" | "individual" | "organisation";

export function Onboarding() {
  const { ready, session, wrongChain, chainId, fixChain } = useWallet();
  const router = useRouter();
  const [path, setPath] = React.useState<Path>("choose");

  if (!ready) {
    return (
      <div className="page-container py-16">
        <SkeletonLabel>Checking your session</SkeletonLabel>
        <Skeleton className="mb-4 h-8 w-56" />
        <Skeleton shape="block" />
      </div>
    );
  }

  if (!session) {
    return (
      <Frame kicker="Get started" title="Sign in first">
        <p className="text-sm leading-relaxed text-ink-muted">
          Onboarding starts from a wallet signature, because the identity being
          created belongs to a wallet rather than to an email address. Use the
          connect button in the top bar.
        </p>
      </Frame>
    );
  }

  if (wrongChain) {
    return (
      <Frame kicker="Get started" title="Wrong network">
        <p className="mb-5 text-sm leading-relaxed text-ink-muted">
          Your wallet is on chain {chainId}, and this registry lives on{" "}
          {CHAIN.name} ({CHAIN.id}). Registering an identity on the wrong chain
          would anchor it somewhere nothing else can read.
        </p>
        <Button variant="primary" onClick={() => void fixChain()}>
          Switch to {CHAIN.name}
        </Button>
      </Frame>
    );
  }

  // Already through it. Sending them back around the loop would be worse than
  // telling them there is nothing to do.
  if (session.identity.registered && session.memberships.length > 0) {
    return (
      <Frame kicker="Get started" title="You are already set up">
        <p className="mb-5 text-sm leading-relaxed text-ink-muted">
          This wallet holds a registered identity and belongs to{" "}
          {session.memberships.length === 1
            ? "an organisation"
            : `${session.memberships.length} organisations`}
          . There is nothing left to do here.
        </p>
        <Button variant="primary" onClick={() => router.push("/dashboard")}>
          Open the console
        </Button>
      </Frame>
    );
  }

  if (path === "individual") {
    return (
      <Frame kicker="Individual" title="Create your identity" onBack={() => setPath("choose")}>
        <IndividualFlow />
      </Frame>
    );
  }

  if (path === "organisation") {
    return (
      <Frame kicker="Organisation" title="Set up an organisation" onBack={() => setPath("choose")}>
        <OrganisationFlow />
      </Frame>
    );
  }

  return (
    <Frame kicker="Get started" title="Which are you?">
      <p className="mb-6 max-w-xl text-sm leading-relaxed text-ink-muted">
        Both paths begin the same way — an identity anchored to this wallet — so
        the choice only decides what happens after that.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Choice
          title="I am joining an organisation"
          badge="Individual"
          bullets={[
            "Create an identity anchored to this wallet",
            "An admin then adds you by address",
            "Your details stay encrypted; only a hash is published",
          ]}
          onChoose={() => setPath("individual")}
        />
        <Choice
          title="I am setting one up"
          badge="Organisation"
          bullets={[
            "Create an identity, then the organisation",
            "You become its root admin, permanently",
            "Add members and mint certificates afterwards",
          ]}
          onChoose={() => setPath("organisation")}
        />
      </div>

      {session.identity.registered ? (
        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          Your identity is already registered, so either path will skip that step.
        </p>
      ) : null}
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */

function Choice({
  title,
  badge,
  bullets,
  onChoose,
}: {
  title: string;
  badge: string;
  bullets: string[];
  onChoose: () => void;
}) {
  return (
    <GlassCard padding="md" interactive className="flex flex-col">
      <Badge tone="brand" className="mb-3 self-start">
        {badge}
      </Badge>
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      <ul className="mb-5 flex flex-1 list-disc flex-col gap-1.5 ps-4 text-xs leading-relaxed text-ink-muted">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <Button variant="primary" onClick={onChoose}>
        Continue
      </Button>
    </GlassCard>
  );
}

function Frame({
  kicker,
  title,
  children,
  onBack,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="page-container py-12 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <p className="mb-4">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
            >
              ← Choose again
            </button>
          ) : (
            <Link
              href="/"
              className="font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
            >
              ← owneX
            </Link>
          )}
        </p>
        <p className="label-xs mb-2 text-accent">{kicker}</p>
        <h1 className="display-sm mb-6 text-2xl font-semibold text-ink sm:text-3xl">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
