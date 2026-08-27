/**
 * WCAG contrast check for the owneX token layer.
 *
 * Parses the light and dark palettes out of app/globals.css and asserts that
 * every text-on-surface pair meets AA: 4.5:1 for body text, 3:1 for large or
 * micro labels, and a self-imposed floor for borders against their surface.
 *
 * Run with: npm run check:contrast
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, "..", "app", "globals.css"), "utf8");

function block(selector) {
  const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "m");
  const match = CSS.match(re);
  if (!match) throw new Error(`block ${selector} not found`);
  const tokens = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/--([a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

function toRgb(hex) {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fgHex, bgHex) {
  const fg = toRgb(fgHex);
  const bg = toRgb(bgHex);
  if (!fg || !bg) return null;
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum, description] */
const PAIRS = [
  ["ink", "background", 4.5, "body text on page"],
  ["ink", "surface", 4.5, "body text on card"],
  ["ink", "surface-2", 4.5, "body text on subtle surface"],
  ["ink", "surface-3", 4.5, "body text on raised surface"],
  ["ink-muted", "background", 4.5, "secondary text on page"],
  ["ink-muted", "surface", 4.5, "secondary text on card"],
  ["ink-muted", "surface-2", 4.5, "secondary text on subtle surface"],
  ["ink-faint", "background", 3.0, "micro label on page"],
  ["ink-faint", "surface-2", 3.0, "micro label on subtle surface"],
  ["brand", "background", 4.5, "brand text on page"],
  ["brand", "surface", 4.5, "brand text on card"],
  ["brand", "brand-soft", 4.5, "brand text on brand tint"],
  ["brand-ink", "brand", 4.5, "button label on brand fill"],
  ["accent", "surface", 4.5, "accent text on card"],
  ["accent", "brand-soft", 4.5, "accent text on brand tint"],
  ["accent-ink", "accent", 4.5, "label on accent fill"],
  ["data", "surface", 4.5, "data text on card"],
  ["success", "surface", 4.5, "success text on card"],
  ["warn", "surface", 4.5, "warning text on card"],
  ["danger", "surface", 4.5, "danger text on card"],
  ["ring", "background", 3.0, "focus ring on page"],
  ["flare", "background", 4.5, "warm accent text on page"],
  ["flare", "surface", 4.5, "warm accent text on card"],
  ["flare-ink", "flare", 4.5, "label on warm accent fill"],
  ["border", "surface", 1.3, "border against card"],
];

const themes = { green: block(":root"), light: block("\\.light") };
const failures = [];
const rows = [];

for (const [themeName, tokens] of Object.entries(themes)) {
  for (const [fg, bg, min, label] of PAIRS) {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    if (!fgValue || !bgValue) {
      failures.push(`${themeName}: missing token ${fg} or ${bg}`);
      continue;
    }
    const r = ratio(fgValue, bgValue);
    if (r === null) {
      rows.push(`${themeName.padEnd(5)} SKIP  ${fg} on ${bg} (${fgValue})`);
      continue;
    }
    const pass = r >= min;
    rows.push(
      `${themeName.padEnd(5)} ${pass ? "PASS" : "FAIL"}  ${r
        .toFixed(2)
        .padStart(5)}:1  min ${min}  ${fg} on ${bg}  (${label})`,
    );
    if (!pass) {
      failures.push(
        `${themeName}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1 (${label})`,
      );
    }
  }
}

console.log(rows.join("\n"));
console.log(
  failures.length
    ? `\nFAILURES (${failures.length}):\n${failures.join("\n")}`
    : `\nAll ${rows.length} checks passed.`,
);
process.exit(failures.length ? 1 : 0);
