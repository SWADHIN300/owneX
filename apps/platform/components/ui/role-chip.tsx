import { cn } from "@/lib/cn";

/** Roles as defined by OrgAccessManager, plus the revoked/never-a-member case. */
export type Role = "ADMIN" | "MANAGER" | "AUDITOR" | "USER" | "NONE";

const ROLE_STYLE: Record<Role, string> = {
  ADMIN: "border-brand-line bg-brand text-brand-ink",
  MANAGER: "border-brand-line bg-brand-soft text-brand",
  AUDITOR: "border-data/35 bg-data/10 text-data",
  USER: "border-border bg-surface-2 text-ink-muted",
  NONE: "border-danger/35 bg-danger/10 text-danger",
};

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  AUDITOR: "Auditor",
  USER: "User",
  NONE: "No access",
};

export interface RoleChipProps {
  role: Role;
  /** Renders the expiry beside the role, for time-bound memberships. */
  expiresAt?: string;
  className?: string;
}

export function RoleChip({ role, expiresAt, className }: RoleChipProps) {
  return (
    <span
      data-slot="role-chip"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-[0.6875rem] leading-none font-semibold whitespace-nowrap",
        ROLE_STYLE[role],
        className,
      )}
    >
      {ROLE_LABEL[role]}
      {expiresAt ? (
        <span className="font-mono font-normal opacity-80">
          till {expiresAt}
        </span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export type VerificationState =
  | "verified"
  | "pending"
  | "unverified"
  | "revoked"
  | "tampered";

const STATE_STYLE: Record<VerificationState, string> = {
  verified: "border-success/35 bg-success/10 text-success",
  pending: "border-warn/35 bg-warn/10 text-warn",
  unverified: "border-border bg-surface-2 text-ink-muted",
  revoked: "border-danger/35 bg-danger/10 text-danger",
  tampered: "border-danger/35 bg-danger/10 text-danger",
};

const STATE_LABEL: Record<VerificationState, string> = {
  verified: "Verified",
  pending: "Pending",
  unverified: "Unverified",
  revoked: "Revoked",
  tampered: "Hash mismatch",
};

export interface VerificationBadgeProps {
  state: VerificationState;
  /** Adds the meaning in plain words, for the first use on a page. */
  withHint?: boolean;
  className?: string;
}

const STATE_HINT: Record<VerificationState, string> = {
  verified: "hash matches the chain",
  pending: "waiting for confirmation",
  unverified: "not checked yet",
  revoked: "access withdrawn",
  tampered: "record was altered",
};

export function VerificationBadge({
  state,
  withHint = false,
  className,
}: VerificationBadgeProps) {
  return (
    <span
      data-slot="verification-badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-[0.6875rem] leading-none font-semibold",
        // The hint makes this long enough to need wrapping on narrow screens.
        withHint ? "whitespace-normal" : "whitespace-nowrap",
        STATE_STYLE[state],
        className,
      )}
    >
      <StateIcon state={state} />
      {STATE_LABEL[state]}
      {withHint ? (
        <span className="font-normal opacity-75">{STATE_HINT[state]}</span>
      ) : null}
    </span>
  );
}

function StateIcon({ state }: { state: VerificationState }) {
  // Shape carries the meaning as well as colour, so the state is still readable
  // without colour vision.
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {state === "verified" ? <path d="M3 8.5l3.5 3.5L13 5" /> : null}
      {state === "pending" ? <path d="M8 4v4l3 2" /> : null}
      {state === "unverified" ? <circle cx="8" cy="8" r="5" /> : null}
      {state === "revoked" ? <path d="M4 4l8 8M12 4l-8 8" /> : null}
      {state === "tampered" ? <path d="M8 3v6M8 12.5v.5" /> : null}
    </svg>
  );
}
