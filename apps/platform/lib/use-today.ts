"use client";

import { useSyncExternalStore } from "react";

const NOOP_SUBSCRIBE = () => () => {};

/** `yyyy-mm-dd` in the visitor's own timezone, which is what a date input wants. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const SERVER_SNAPSHOT = () => "";

/**
 * Today's date, readable during render.
 *
 * `Date.now()` called in a component body is impure — the lint rule
 * `react-hooks/purity` is on and treats it as an error, correctly: a value that
 * changes on every render makes the render non-idempotent. But an expiry field
 * genuinely needs to know what "in the past" means in order to disable a button
 * before the contract has to reject the transaction.
 *
 * `useSyncExternalStore` is the sanctioned way to read a changing external value,
 * and the same tool `useMounted` uses. The snapshot is a string, so React's
 * identity check is a value comparison and the result is stable for the whole day
 * rather than differing between two renders a millisecond apart.
 *
 * Empty on the server, because a date rendered from the server's timezone would
 * be wrong for half the world and would not match on hydration.
 */
export function useToday(): string {
  return useSyncExternalStore(NOOP_SUBSCRIBE, today, SERVER_SNAPSHOT);
}
