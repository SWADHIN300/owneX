import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with Tailwind conflict resolution. `clsx` handles
 * conditionals, `twMerge` makes sure a later utility wins over an earlier one in
 * the same group, so component defaults can always be overridden by a caller's
 * `className`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
