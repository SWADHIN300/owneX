import { BrandLockup } from "@/components/brand";
import { GlassCard } from "@/components/ui";
import { GetStartedButton } from "@/components/wallet/get-started-button";

const COLUMNS = [
  {
    heading: "Platform",
    links: ["Identity", "Access control", "Asset custody", "Audit trail"],
  },
  {
    heading: "Developers",
    links: ["Documentation", "Smart contracts", "API reference", "Self-hosting"],
  },
  {
    heading: "Resources",
    links: ["Architecture", "Security model", "Standards", "Changelog"],
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
              <h2 className="display-sm mb-4 text-3xl font-semibold text-white sm:text-4xl">
                Own what is yours.
                <br />
                Prove it onchain.
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-white/70">
                Issue verifiable identities, enforce permissions in smart
                contracts, and keep an ownership record neither you nor anyone
                else can quietly rewrite.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <GetStartedButton />
              <a
                href="#evidence"
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors duration-200 hover:bg-white/15"
              >
                Read the docs
              </a>
            </div>
          </div>
        </GlassCard>

        <div className="grid gap-10 border-b border-border pb-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <BrandLockup className="mb-4" />
            <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
              Decentralised identity, smart-contract access control, and
              NFT-backed asset custody with a tamper-evident audit trail.
            </p>
            <p className="mt-4 font-mono text-[0.625rem] text-ink-faint">
              Open source. Self-hostable. No vendor lock-in.
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
            {year} owneX. Released under an open source licence.
          </p>
          <p className="font-mono text-xs text-ink-faint">
            Testnet only. Pending external security audit.
          </p>
        </div>
      </div>
    </footer>
  );
}
