/**
 * Pure address formatting helpers.
 *
 * These live outside `components/ui` on purpose. Anything exported from a
 * `"use client"` module becomes a *client reference*: a server component may
 * render it as a component, but calling it as a function throws at runtime
 * ("Attempted to call shortenAddress() from the server..."). That failure is
 * invisible at build time, so the pure helpers a server component needs to call
 * must not live behind the client boundary.
 */

/** Truncate to the first and last characters, which is how wallets are read. */
export function shortenAddress(address: string, head = 6, tail = 4): string {
  if (typeof address !== "string") return "";
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}
