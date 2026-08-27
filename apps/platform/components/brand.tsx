import { cn } from "@/lib/cn";

/**
 * The owneX mark.
 *
 * Rendered as a CSS mask filled from `currentColor`, not as an <img>. The supplied
 * artwork is one flat dark green, which would vanish against the dark canvas; as a
 * mask it always takes the colour of the text around it, so a single asset serves
 * both themes.
 *
 * It is decorative here: the lockup's wordmark already carries the name, and the
 * link that wraps it has its own label, so announcing the mark too would repeat.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      // Matches the artwork's own 954x883 proportions, so nothing is letterboxed.
      className={cn("logo-mark inline-block aspect-[954/883]", className)}
    />
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

/**
 * Brand lockup.
 *
 * The mark is sized to the wordmark's cap height rather than its full line box.
 * At 28px it stood taller than the letterforms, which read as a gap between the
 * two even though the spacing was tight. Leading is trimmed off the wordmark for
 * the same reason, so the two sit on one optical line.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark className="h-[1.375rem] text-brand" />
      <Wordmark className="leading-none" />
    </span>
  );
}
