import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shortenAddress } from "./address.ts";

const libDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(libDir, "..");
const read = (...p: string[]) => readFileSync(join(appDir, ...p), "utf8");

test("shortens a full wallet address", () => {
  assert.equal(shortenAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"), "0x7099...79C8");
});

test("leaves short values untouched and tolerates bad input", () => {
  assert.equal(shortenAddress("0x1234"), "0x1234");
  assert.equal(shortenAddress(""), "");
  // @ts-expect-error deliberately passing a non-string
  assert.equal(shortenAddress(undefined), "");
});

test("honours custom head and tail lengths", () => {
  assert.equal(shortenAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 4, 2), "0x70...C8");
});

// ── Regression guards ────────────────────────────────────────────────
// /authorize is a server component. Importing a *callable* helper from a
// "use client" module makes it a client reference, and calling it throws only at
// runtime, only on the signed-in branch. These checks fail at test time instead.

/** Matches a real `"use client"` directive, not the phrase inside a comment. */
const USE_CLIENT_DIRECTIVE = /^\s*["']use client["'];?\s*$/m;

test("lib/address.ts is not behind the client boundary", () => {
  assert.ok(!USE_CLIENT_DIRECTIVE.test(read("lib", "address.ts")));
  // Sanity check: the directive regex does detect a module that has one.
  assert.ok(USE_CLIENT_DIRECTIVE.test(read("components", "ui", "network-chip.tsx")));
});

test("the authorize server page does not import shortenAddress from the UI barrel", () => {
  const page = read("app", "authorize", "page.tsx");
  assert.ok(
    /import\s*\{[^}]*\bshortenAddress\b[^}]*\}\s*from\s*"@\/lib\/address"/.test(page),
    "authorize page must import shortenAddress from @/lib/address",
  );
  const barrelImport = /import\s*\{([^}]*)\}\s*from\s*"@\/components\/ui"/.exec(page);
  assert.ok(barrelImport, "expected an @/components/ui import to inspect");
  assert.ok(
    !barrelImport[1].includes("shortenAddress"),
    "shortenAddress must not come from the client UI barrel in a server component",
  );
});

test("the UI barrel re-exports shortenAddress from the server-safe module", () => {
  assert.match(read("components", "ui", "index.ts"), /export\s*\{\s*shortenAddress\s*\}\s*from\s*"@\/lib\/address"/);
});

test("a root error boundary exists so server throws are not a blank screen", () => {
  const boundary = read("app", "error.tsx");
  assert.ok(boundary.includes('"use client"'));
  assert.ok(boundary.includes("digest"));
});
