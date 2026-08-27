"use client";

import * as React from "react";

/**
 * The smallest thing that reads an API endpoint into a component.
 *
 * Deliberately not a data-fetching library. Four screens need "load this, show
 * a skeleton, show the failure, let me reload" and nothing more: no cache
 * across routes, no background revalidation, no query keys. Roles must never be
 * cached client-side, so a library whose main feature is caching would be
 * working against the rule rather than for it.
 *
 * Two constraints shaped the implementation:
 *
 *   1. `react-hooks/set-state-in-effect` is an error in this project, so state
 *      is only ever written from a promise callback — never synchronously while
 *      the effect body runs.
 *   2. Switching to a new loader must show loading again without an effect that
 *      resets state. That is derived instead: the result remembers which loader
 *      produced it, and anything from a different loader is stale by definition.
 *
 * The loader must be wrapped in `useCallback`, because its identity is what
 * marks a result fresh or stale.
 */

export type ResourceStatus = "idle" | "loading" | "ready" | "error";

export interface Resource<T> {
  status: ResourceStatus;
  /** Last value that loaded successfully, kept during a reload. */
  data: T | undefined;
  error: unknown;
  /** Discards the current result and runs the loader again. */
  reload: () => void;
  /** True while a reload is in flight over data that is already on screen. */
  refreshing: boolean;
}

type Settled<T> =
  | { ok: true; loader: unknown; nonce: number; data: T }
  | { ok: false; loader: unknown; nonce: number; error: unknown };

/**
 * @param load  memoised loader, or `null` when there is nothing to load yet —
 *              a page whose org id is not known returns `idle` rather than
 *              firing a request against `orgId=NaN`.
 */
export function useResource<T>(load: (() => Promise<T>) | null): Resource<T> {
  const [settled, setSettled] = React.useState<Settled<T> | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!load) return;
    let cancelled = false;

    void load().then(
      (data) => {
        if (!cancelled) setSettled({ ok: true, loader: load, nonce, data });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ ok: false, loader: load, nonce, error });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [load, nonce]);

  const fresh =
    settled !== null && settled.loader === load && settled.nonce === nonce;

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  if (!load) {
    return { status: "idle", data: undefined, error: null, reload, refreshing: false };
  }

  // Data from a previous nonce is still worth showing while the next load runs:
  // a table that blanks itself on every refresh is worse than a stale table
  // with a "refreshing" note.
  const lastData = settled?.ok ? settled.data : undefined;

  if (!fresh) {
    return {
      status: "loading",
      data: lastData,
      error: null,
      reload,
      refreshing: lastData !== undefined,
    };
  }

  if (settled.ok) {
    return { status: "ready", data: settled.data, error: null, reload, refreshing: false };
  }

  return { status: "error", data: undefined, error: settled.error, reload, refreshing: false };
}
