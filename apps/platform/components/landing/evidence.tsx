import { Badge, GlassCard } from "@/components/ui";

/** Figures verified by `npm run verify:all`, not marketing numbers. */
const METRICS = [
  { value: "93", label: "contract tests passing" },
  { value: "86", label: "API assertions passing" },
  { value: "13", label: "API endpoints" },
  { value: "3", label: "smart contracts" },
];

const PROVEN = [
  "A plain user calling mintAsset reverts at the contract, not the interface.",
  "A holder calling transferFrom reverts with TransfersLocked.",
  "Nobody can promote themselves, including a full admin targeting their own membership.",
  "A revoked identity loses every role, permission and app access in the same block.",
  "Altering one character of an encrypted record breaks its hash check.",
];

const PHASES = [
  { name: "Smart contracts", state: "done" as const },
  { name: "Tests, deploy, seed", state: "done" as const },
  { name: "Backend and role API", state: "done" as const },
  { name: "Design system and landing", state: "current" as const },
  { name: "Platform dashboard", state: "next" as const },
  { name: "Employee portal", state: "next" as const },
];

export function Evidence() {
  return (
    <section id="evidence" className="border-b border-border">
      <div className="page-container py-16 sm:py-24">
        <div className="mb-12 grid gap-6 md:grid-cols-2 md:items-end">
          <div>
            <p className="label-xs mb-4 text-accent">Evidence</p>
            <h2 className="display text-3xl font-semibold text-ink sm:text-4xl">
              Already proven,
              <br />
              not theoretical.
            </h2>
          </div>
          <p className="max-w-md text-base leading-relaxed text-ink-muted md:justify-self-end">
            The trust layer runs against a live chain and a live database. These
            are the numbers the test suite reports.
          </p>
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {METRICS.map((metric) => (
            <GlassCard key={metric.label} padding="md">
              <dt className="sr-only">{metric.label}</dt>
              <dd>
                <span className="display block text-4xl font-semibold text-brand">
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
              Security assertions that are proven, not assumed
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
            <h3 className="label-xs mb-4 text-ink-faint">Build status</h3>
            <ol className="flex flex-col gap-2.5">
              {PHASES.map((phase, index) => (
                <li
                  key={phase.name}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2.5 text-sm text-ink">
                    <span className="font-mono text-xs text-ink-faint">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {phase.name}
                  </span>
                  <Badge
                    tone={
                      phase.state === "done"
                        ? "success"
                        : phase.state === "current"
                          ? "brand"
                          : "neutral"
                    }
                  >
                    {phase.state === "done"
                      ? "Done"
                      : phase.state === "current"
                        ? "Current"
                        : "Next"}
                  </Badge>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Built for Smart India Hackathon. Not audited and not deployed to a
              production network.
            </p>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
