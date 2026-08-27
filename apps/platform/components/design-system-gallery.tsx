"use client";

import * as React from "react";

import {
  Badge,
  Button,
  GlassCard,
  Identicon,
  Input,
  Modal,
  NetworkChip,
  RoleChip,
  Select,
  Skeleton,
  SkeletonLabel,
  ToastProvider,
  useToast,
  VerificationBadge,
  WalletPill,
} from "@/components/ui";
import type { CardGradient } from "@/components/ui";

const GRADIENTS: CardGradient[] = [
  "dawn",
  "aurora",
  "deep",
  "canopy",
  "sand",
  "dusk",
];

const ADDRESSES = [
  "0x69FD7a4C1b2E5d8A9f0C3b6E1d4A7c2F5b83888",
  "0x1aC28f5b90D7e34a6C81f20b5dE9a473c6F19f41",
  "0x3dA1c604f79b25e8a03d1c6b5f4e29a70d8b177c",
  "0x8bE04a17c5D92f3e6b08a71c4d5f29e30b6a15d1",
];

/** Wrapped so the gallery can call useToast. */
export function DesignSystemGallery() {
  return (
    <ToastProvider>
      <GalleryBody />
    </ToastProvider>
  );
}

function GalleryBody() {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  return (
    <div className="flex flex-col gap-12">
      <Section title="Buttons" caption="Five variants, three sizes, loading state">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
          <Button
            loading={loading}
            onClick={() => {
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1400);
            }}
          >
            {loading ? "Signing" : "Simulate signing"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Fields" caption="Label, hint, error and monospace variants">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Organisation name" placeholder="Northwind Industries" />
          <Input
            label="Wallet address"
            mono
            placeholder="0x..."
            hint="Checksummed address of the member"
          />
          <Input
            label="Asset serial"
            defaultValue="SN-0042"
            error="Serial already registered in this organisation"
          />
          <Select
            label="Role"
            placeholder="Choose a role"
            defaultValue=""
            options={[
              { value: "admin", label: "Admin" },
              { value: "manager", label: "Manager" },
              { value: "auditor", label: "Auditor" },
              { value: "user", label: "User" },
            ]}
            hint="Permissions are enforced by the contract"
          />
        </div>
      </Section>

      <Section title="Identity" caption="Deterministic avatars and wallet state">
        <div className="flex flex-wrap items-center gap-4">
          {ADDRESSES.map((address) => (
            <Identicon key={address} value={address} size={44} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <WalletPill address={ADDRESSES[0]} />
          <WalletPill
            address={ADDRESSES[1]}
            onDisconnect={() =>
              toast({
                title: "Wallet disconnected",
                description: "The session cookie was cleared.",
                tone: "info",
              })
            }
          />
          <WalletPill address={ADDRESSES[2]} displayName="ops.northwind.eth" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <NetworkChip chainId={31337} expectedChainId={31337} />
          <NetworkChip chainId={11155111} expectedChainId={31337} />
          <NetworkChip />
        </div>
      </Section>

      <Section title="Status" caption="Roles, verification and generic badges">
        <div className="flex flex-wrap items-center gap-3">
          <RoleChip role="ADMIN" />
          <RoleChip role="MANAGER" expiresAt="30 Sep" />
          <RoleChip role="AUDITOR" />
          <RoleChip role="USER" />
          <RoleChip role="NONE" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <VerificationBadge state="verified" />
          <VerificationBadge state="pending" />
          <VerificationBadge state="unverified" />
          <VerificationBadge state="revoked" />
          <VerificationBadge state="tampered" withHint />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Neutral</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="data" mono>
            BLOCK 21904663
          </Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warn">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
        </div>
      </Section>

      <Section title="Surfaces" caption="Six named gradients plus the glass surface">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GRADIENTS.map((gradient) => (
            <GlassCard key={gradient} gradient={gradient} interactive>
              <p className="label-xs mb-8 opacity-80">{gradient}</p>
              <p className="font-mono text-xs opacity-90">
                --gradient-{gradient}
              </p>
            </GlassCard>
          ))}
        </div>
        <GlassCard glass>
          <p className="label-xs mb-2 text-ink-faint">Glass</p>
          <p className="text-sm text-ink-muted">
            Translucent surface with a blur, used for the sticky header and
            overlay panels.
          </p>
        </GlassCard>
      </Section>

      <Section title="Feedback" caption="Modal, toasts and loading placeholders">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Role assigned",
                description: "Manager, expiring 30 September.",
                tone: "success",
              })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Transaction reverted",
                description: "MissingPermission: caller lacks MINT_ASSETS.",
                tone: "danger",
              })
            }
          >
            Error toast
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <GlassCard padding="sm">
            <SkeletonLabel>Loading members</SkeletonLabel>
            <div className="flex items-center gap-3">
              <Skeleton shape="circle" className="size-10" />
              <div className="flex-1 space-y-2">
                <Skeleton className="w-3/4" />
                <Skeleton className="w-1/2" />
              </div>
            </div>
          </GlassCard>
          <GlassCard padding="sm">
            <Skeleton shape="block" />
          </GlassCard>
          <GlassCard padding="sm">
            <div className="space-y-2">
              <Skeleton />
              <Skeleton className="w-5/6" />
              <Skeleton className="w-2/3" />
            </div>
          </GlassCard>
        </div>
      </Section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Revoke identity"
        description="This drops every role and app access for the wallet in one transaction."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setModalOpen(false);
                toast({
                  title: "Identity revoked",
                  description: "Access removed across every organisation.",
                  tone: "warn",
                });
              }}
            >
              Revoke
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
          <Identicon value={ADDRESSES[0]} size={36} />
          <div className="min-w-0">
            <p className="font-mono text-xs text-ink">{ADDRESSES[0]}</p>
            <div className="mt-1.5 flex gap-2">
              <RoleChip role="MANAGER" />
              <VerificationBadge state="verified" />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{caption}</p>
      </div>
      {children}
    </section>
  );
}
