import { cn } from "@/lib/cn";

/**
 * The owneX mark: an abstract X formed by two interlocking custody layers,
 * held inside a diamond. Tracks `currentColor`, and the two bars carry different
 * weights so the interlock still reads at 20px.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={cn("shrink-0", className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M128 4 L252 128 L128 252 L4 128 Z M128 40 L216 128 L128 216 L40 128 Z"
      />
      <rect
        x="116"
        y="70"
        width="24"
        height="116"
        rx="12"
        opacity="0.55"
        transform="rotate(45 128 128)"
      />
      <rect
        x="116"
        y="70"
        width="24"
        height="116"
        rx="12"
        transform="rotate(-45 128 128)"
      />
    </svg>
  );
}

/** Wordmark. Capitalisation is deliberate: lowercase "owne", uppercase "X". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-lg font-semibold tracking-tight", className)}>
      owne<span className="text-accent">X</span>
    </span>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-7 text-brand" />
      <Wordmark />
    </span>
  );
}
