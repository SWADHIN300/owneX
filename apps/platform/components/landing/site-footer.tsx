import { BrandLockup } from "@/components/brand";
import { Button, GlassCard } from "@/components/ui";

const COLUMNS = [
  {
    heading: "Product",
    links: ["Identity", "Access", "Assets", "Audit"],
  },
  {
    heading: "Developers",
    links: ["Documentation", "Smart contracts", "API reference", "GitHub"],
  },
  {
    heading: "Protocol",
    links: ["Architecture", "Security model", "Standards", "Status"],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-background">
      <div className="page-container py-16 sm:py-20">
        <GlassCard gradient="deep" padding="lg" className="mb-12">
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <h2 className="display mb-4 text-3xl font-semibold text-white sm:text-4xl">
                Own what is yours.
                <br />
                Prove it onchain.
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-white/70">
                Create verifiable identities, enforce permissions through smart
                contracts, and keep a tamper-evident record of who holds what.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Button size="lg" variant="accent">
                Launch owneX
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border-white/20 bg-white/10 text-white hover:bg-white/15"
              >
                View source
              </Button>
            </div>
          </div>
        </GlassCard>

        <div className="grid gap-10 border-b border-border pb-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <BrandLockup className="mb-4" />
            <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
              Verifiable identity, role-based access control, and NFT-backed
              asset ownership with a tamper-evident audit trail.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h3 className="label-xs mb-4 text-ink-faint">{column.heading}</h3>
              <ul className="flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="rounded-sm text-sm text-ink-muted transition-colors duration-200 hover:text-ink"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-start justify-between gap-3 pt-8 sm:flex-row sm:items-center">
          <p className="text-xs text-ink-faint">
            {year} owneX. Built for Smart India Hackathon.
          </p>
          <p className="font-mono text-xs text-ink-faint">
            Protocol concept. Not audited, not on a production network.
          </p>
        </div>
      </div>
    </footer>
  );
}
