"use client";

import * as React from "react";

import {
  ApiRequestError,
  getAudit,
  syncAudit,
  type AuditContract,
  type AuditEvent,
} from "@/lib/api";
import { CHAIN } from "@/lib/wallet";
import { useResource } from "@/lib/use-resource";
import {
  Badge,
  Button,
  GlassCard,
  Input,
  Select,
  useToast,
} from "@/components/ui";
import {
  ApiErrorPanel,
  EmptyPanel,
  LoadingPanel,
} from "@/components/console/states";
import {
  ScreenHeader,
  useConsoleScreen,
} from "@/components/console/use-console-screen";
import { AUDIT_EVENTS } from "./audit-events";
import { AuditRow } from "./audit-row";

/**
 * Audit Trail.
 *
 * The chain is the record; this reads a Postgres cache of it so filtering and
 * paging are instant instead of one RPC round trip per scroll. Nothing is lost by
 * caching, because every row carries the transaction hash and block number that
 * prove it — if the cache were wiped or doctored, it could be rebuilt from the
 * chain and the difference would show.
 *
 * Reading it needs VIEW_AUDIT, which by default means Admin, Manager or Auditor.
 * A plain User gets a 403, and that is rendered as an explanation rather than an
 * empty table.
 */

const ALL = "__all__";
const PAGE_SIZE = 25;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const CONTRACTS: AuditContract[] = [
  "IdentityRegistry",
  "OrgAccessManager",
  "AssetNFT",
];

export function AuditTrail() {
  const { session, orgId, role, gate } = useConsoleScreen();
  const { toast } = useToast();

  const [contract, setContract] = React.useState<string>(ALL);
  const [event, setEvent] = React.useState<string>(ALL);
  const [walletInput, setWalletInput] = React.useState("");
  const [tokenInput, setTokenInput] = React.useState("");

  // The API rejects a malformed address with a 400, so a half-typed one is held
  // back rather than sent and turned into an error panel mid-keystroke.
  const walletValid = walletInput === "" || ADDRESS.test(walletInput.trim());
  const wallet = walletValid && walletInput ? walletInput.trim() : undefined;

  const tokenNumber = Number(tokenInput);
  const tokenValid =
    tokenInput === "" || (Number.isInteger(tokenNumber) && tokenNumber > 0);
  const tokenId = tokenValid && tokenInput ? tokenNumber : undefined;

  const query = React.useMemo(
    () => ({
      contract: contract === ALL ? undefined : (contract as AuditContract),
      event: event === ALL ? undefined : event,
      wallet,
      tokenId,
    }),
    [contract, event, wallet, tokenId],
  );

  const load = React.useCallback(() => {
    if (orgId === null) return Promise.reject(new Error("No organisation"));
    return getAudit({ orgId, ...query, limit: PAGE_SIZE });
  }, [orgId, query]);

  const firstPage = useResource(gate === null && orgId !== null ? load : null);

  /* Older pages, appended. Keyed by the filter set that produced them, so
     changing a filter discards them by derivation rather than by an effect that
     writes state. */
  const filterKey = JSON.stringify([orgId, query]);
  const [older, setOlder] = React.useState<{
    key: string;
    events: AuditEvent[];
    cursor: number | null;
    hasMore: boolean;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);

  const appended = older?.key === filterKey ? older : null;

  const events = [...(firstPage.data?.events ?? []), ...(appended?.events ?? [])];
  const cursor = appended ? appended.cursor : (firstPage.data?.nextCursor ?? null);
  const hasMore = appended ? appended.hasMore : (firstPage.data?.hasMore ?? false);

  const loadOlder = async () => {
    if (orgId === null || cursor === null) return;
    setLoadingOlder(true);
    try {
      const next = await getAudit({ orgId, ...query, limit: PAGE_SIZE, cursor });
      setOlder((current) => ({
        key: filterKey,
        events: [
          ...(current?.key === filterKey ? current.events : []),
          ...next.events,
        ],
        cursor: next.nextCursor,
        hasMore: next.hasMore,
      }));
    } catch (caught) {
      toast({
        title: "Could not load older entries",
        description: caught instanceof Error ? caught.message : "Unknown failure",
        tone: "danger",
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAudit();
      setOlder(null);
      firstPage.reload();
      toast({
        title:
          result.indexed === 0
            ? "Already up to date"
            : `Indexed ${result.indexed} new ${result.indexed === 1 ? "event" : "events"}`,
        description: result.resetDetected
          ? "The chain behind the cache had been replaced, so the old entries were dropped and it was rebuilt from block zero."
          : `Read up to block ${result.toBlock}.`,
        tone: result.resetDetected ? "warn" : "success",
      });
    } catch (caught) {
      toast({
        title: "Sync failed",
        description:
          caught instanceof Error
            ? caught.message
            : `Could not reach ${CHAIN.name}.`,
        tone: "danger",
      });
    } finally {
      setSyncing(false);
    }
  };

  const eventOptions =
    contract === ALL
      ? AUDIT_EVENTS
      : AUDIT_EVENTS.filter((e) => e.contract === contract);

  // Syncing is open to any signed-in wallet, because it only copies data that is
  // already public on-chain. But offering it beside a refusal to read is noise:
  // a plain USER pressing it would index events and still be denied.
  const denied =
    firstPage.status === "error" &&
    firstPage.error instanceof ApiRequestError &&
    firstPage.error.status === 403;

  const header = (
    <ScreenHeader
      kicker="Audit trail"
      title="Everything that happened"
      actions={
        denied ? undefined : (
          <Button
            variant="secondary"
            onClick={() => void runSync()}
            loading={syncing}
          >
            Refresh from chain
          </Button>
        )
      }
    >
      Every row is a contract event on {CHAIN.name}, carrying the transaction that
      produced it. Nobody can edit or delete an entry, including us — the worst
      anyone can do to this cache is empty it, and it rebuilds from the chain.
    </ScreenHeader>
  );

  if (gate) return <div>{header}{gate}</div>;
  if (!session) return null;

  if (firstPage.status === "error") {
    return (
      <div>
        {header}
        <ApiErrorPanel
          error={firstPage.error}
          permission="VIEW_AUDIT"
          role={role}
          onRetry={firstPage.reload}
        />
      </div>
    );
  }

  const filtersApplied =
    contract !== ALL || event !== ALL || Boolean(wallet) || tokenId !== undefined;

  const clearFilters = () => {
    setContract(ALL);
    setEvent(ALL);
    setWalletInput("");
    setTokenInput("");
  };

  return (
    <div>
      {header}

      <GlassCard padding="sm" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Select
            label="Contract"
            value={contract}
            onChange={(e) => {
              setContract(e.target.value);
              // An event name only exists on one contract, so a leftover
              // selection would silently return nothing.
              setEvent(ALL);
            }}
            options={[
              { value: ALL, label: "All three contracts" },
              ...CONTRACTS.map((value) => ({ value, label: value })),
            ]}
          />
          <Select
            label="Event"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            options={[
              { value: ALL, label: "Any event" },
              ...eventOptions.map((e) => ({ value: e.name, label: e.name })),
            ]}
          />
          <Input
            label="Wallet"
            placeholder="0x…"
            mono
            value={walletInput}
            onChange={(e) => setWalletInput(e.target.value)}
            error={walletValid ? undefined : "Needs to be a full 0x address"}
            hint={walletValid ? "Matches the actor or the subject" : undefined}
          />
          <Input
            label="Token id"
            placeholder="e.g. 1"
            mono
            inputMode="numeric"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            error={tokenValid ? undefined : "Needs to be a positive whole number"}
            hint={tokenValid ? "Only asset events carry one" : undefined}
          />
        </div>

        <p
          role="status"
          aria-live="polite"
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-soft pt-3 text-xs text-ink-faint"
        >
          {firstPage.status === "loading" && !firstPage.data
            ? "Loading entries"
            : `${events.length} ${events.length === 1 ? "entry" : "entries"} loaded${hasMore ? ", more available" : ""}`}
          {firstPage.refreshing ? <Badge tone="neutral">Refreshing</Badge> : null}
          {!CHAIN.explorer ? (
            <Badge tone="neutral">
              No explorer configured, so hashes are copy-only
            </Badge>
          ) : null}
          {filtersApplied ? (
            <button type="button" onClick={clearFilters} className="text-accent underline">
              Clear filters
            </button>
          ) : null}
        </p>
      </GlassCard>

      {firstPage.status === "loading" && !firstPage.data ? (
        <LoadingPanel label="Loading the audit trail" rows={5} />
      ) : events.length === 0 ? (
        filtersApplied ? (
          <EmptyPanel
            title="Nothing matches those filters"
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            <p>
              No cached event fits that combination. If you expect one, try{" "}
              <span className="font-semibold text-ink">Refresh from chain</span> —
              the cache only holds what has been indexed so far.
            </p>
          </EmptyPanel>
        ) : (
          <EmptyPanel
            title="No history indexed yet"
            action={
              <Button variant="primary" onClick={() => void runSync()} loading={syncing}>
                Index it now
              </Button>
            }
          >
            <p>
              The contracts have events, but none have been pulled into the cache
              for this organisation. Indexing reads only what is already public
              on-chain and is safe to run twice.
            </p>
          </EmptyPanel>
        )
      ) : (
        <>
          <ol className="flex flex-col">
            {events.map((entry, index) => (
              <AuditRow
                key={entry.id}
                event={entry}
                index={index}
                isLast={index === events.length - 1}
              />
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-faint">
              {hasMore
                ? `Paging back from block ${cursor}.`
                : "That is the whole indexed history."}
            </p>
            {hasMore ? (
              <Button
                variant="secondary"
                onClick={() => void loadOlder()}
                loading={loadingOlder}
              >
                Load older entries
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
