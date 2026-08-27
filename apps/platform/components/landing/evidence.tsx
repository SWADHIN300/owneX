import { Badge, GlassCard } from "@/components/ui";

/** Figures reported by the test suites, not marketing numbers. */
const METRICS = [
  { value: "93", label: "contract tests passing" },
  { value: "86", label: "API assertions passing" },
  { value: "13", label: "API endpoints" },
  { value: "3", label: "smart contracts" },
];

/**
 * Security properties that are enforced in Solidity and covered by a test, rather
 * than described in a document. Each line maps to an assertion in the suite.
 */
const PROVEN = [
  "A member without MINT_ASSETS calling mintAsset reverts at the contract, not at the interface.",
  "A holder calling transferFrom reverts with TransfersLocked. An approved operator cannot move it either.",
  "Nobody can escalate their own role, including an admin targeting their own membership.",
  "Revoking an identity drops every role, permission and application grant in the same block.",
  "A role with an expiry lapses on its own, with no transaction and no scheduled job.",
  "Altering one byte of an encrypted record breaks its onchain hash check.",
];

/** Honest posture on what is production ready and what is not. */
const READINESS = [
  { name: "Smart contracts", state: "ready" as const, note: "OpenZeppelin 5, 93 tests" },
  { name: "Identity and RBAC API", state: "ready" as const, note: "86 live assertions" },
  { name: "Encrypted off-chain store", state: "ready" as const, note: "Postgres, RLS on every table" },
  { name: "Design system", state: "ready" as const, note: "Tokenised, contrast verified" },
  { name: "Operator console", state: "building" as const, note: "In progress" },
  { name: "External security audit", state: "required" as const, note: "Before any mainnet use" },
  { name: "Key recovery for end users", state: "required" as const, note: "Guardian model designed" },
];

const STATE_LABEL = {
  ready: "Ready",
  building: "Building",
  required: "Required",
} as const;

const STATE_TONE = {
  ready: "success",
  building: "brand",
  required: "warn",
} as const;

export function Evidence() {
  return (
    <section id="evidence" className="border-b border-border">
      <div className="page-container py-16 sm:py-24">
        <div className="mb-12 grid gap-6 md:grid-cols-2 md:items-end">
          <div>
            <p className="label-xs mb-4 text-accent">Security and status</p>
            <h2 className="display-sm text-3xl font-semibold text-ink sm:text-4xl">
              Enforced in code,
              <br />
              not in a policy document.
            </h2>
          </div>
          <p className="max-w-md text-base leading-relaxed text-ink-muted md:justify-self-end">
            The trust layer runs against a live chain and a live database. Every
            claim below is covered by a test you can run with one command.
          </p>
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {METRICS.map((metric) => (
            <GlassCard key={metric.label} padding="md">
              <dt className="sr-only">{metric.label}</dt>
              <dd>
                <span className="block font-mono text-4xl font-bold tracking-tight text-brand">
                  {metric.value}
                </span>
                <span className="mt-1.5 block text-xs text-ink-muted">
                  {metric.label}
                </span>
              </dd>
            </GlassCard>
          ))}
        </dl>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <GlassCard padding="md">
            <h3 className="label-xs mb-4 text-ink-faint">
              Properties proven by the test suite
            </h3>
            <ul className="flex flex-col gap-3">
              {PROVEN.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <svg
                    viewBox="0 0 16 16"
                    className="mt-0.5 size-4 shrink-0 text-success"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M3 8.5l3.5 3.5L13 5" />
                  </svg>
                  <span className="text-sm leading-relaxed text-ink-muted">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard padding="md">
            <h3 className="label-xs mb-4 text-ink-faint">
              Production readiness
            </h3>
            <ul className="flex flex-col gap-3">
              {READINESS.map((item) => (
                <li
                  key={item.name}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{item.name}</span>
                    <span className="block font-mono text-[0.625rem] text-ink-faint">
                      {item.note}
                    </span>
                  </span>
                  <Badge tone={STATE_TONE[item.state]}>
                    {STATE_LABEL[item.state]}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Currently deployed to a local chain and a testnet. Not audited, and
              not recommended for mainnet or for custody of anything valuable
              until it is.
            </p>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
