import { MeshBackdrop } from "./mesh-backdrop";
import { Badge, Button } from "@/components/ui";

const META = [
  { label: "Identity", value: "Wallet-bound DID" },
  { label: "Access", value: "Onchain RBAC" },
  { label: "Assets", value: "ERC-721 custody" },
  { label: "Audit", value: "Immutable events" },
];

export function Hero() {
  return (
    <section
      id="top"
      className="grid-backdrop relative overflow-hidden border-b border-border"
    >
      {/* Warm corner wash so the grid fades instead of stopping at the edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 80% at 78% 12%, var(--brand-soft), transparent 60%)",
        }}
      />

      <div className="page-container relative grid items-center gap-10 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:py-24">
        <div className="flex flex-col items-start">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <Badge tone="brand">Decentralised trust infrastructure</Badge>
            <Badge tone="neutral" mono>
              EVM COMPATIBLE
            </Badge>
          </div>

          <h1 className="display mb-6 text-4xl font-semibold text-ink sm:text-5xl lg:text-6xl">
            Own it.
            <br />
            Prove it.
            <br />
            <span className="text-accent">Onchain.</span>
          </h1>

          <p className="mb-8 max-w-lg text-base leading-relaxed text-ink-muted sm:text-lg">
            owneX gives an organisation verifiable identities, permissions
            enforced by smart contracts, and asset ownership anyone can check.
            Personal data never goes on the chain.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg">Launch owneX</Button>
            <Button size="lg" variant="secondary">
              Read the docs
            </Button>
          </div>

          <p className="mt-6 font-mono text-xs text-ink-faint">
            3 contracts · 13 endpoints · 93 contract tests · 86 API assertions
          </p>
        </div>

        <div className="relative w-full">
          <MeshBackdrop className="mx-auto max-w-[26rem] lg:max-w-[32rem]" />
        </div>
      </div>

      {/* Protocol footing. */}
      <dl className="page-container relative grid grid-cols-2 gap-px border-t border-border-soft lg:grid-cols-4">
        {META.map((item) => (
          <div key={item.label} className="px-1 py-5">
            <dt className="label-xs mb-1.5 text-ink-faint">{item.label}</dt>
            <dd className="font-mono text-sm text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
