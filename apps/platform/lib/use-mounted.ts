"use client";

import { useSyncExternalStore } from "react";

const NOOP_SUBSCRIBE = () => () => {};
const CLIENT_SNAPSHOT = () => true;
const SERVER_SNAPSHOT = () => false;

/**
 * `false` during server render and the first client render, `true` afterwards.
 *
 * Uses `useSyncExternalStore` rather than a `useState` plus `useEffect` pair, so
 * there is no state write inside an effect and therefore no cascading render.
 * Needed anywhere the markup must match on hydration but the behaviour depends on
 * the browser, such as portals and theme-aware icons.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    NOOP_SUBSCRIBE,
    CLIENT_SNAPSHOT,
    SERVER_SNAPSHOT,
  );
}
