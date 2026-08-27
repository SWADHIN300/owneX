# Phase 4 — Design system + landing page

Everything the interface is built from, plus the first page a visitor sees.
Phase 5 assembles the dashboard out of these parts, so this phase is deliberately
about the system rather than the screens.

```
50 contrast checks passing  ·  lint clean  ·  typecheck clean  ·  production build clean
```

---

## Type

| Role | Face | Why |
|---|---|---|
| Display, labels, data | **Martian Mono** | Unusually wide and heavy for a monospace, so it carries an oversized headline without looking like code. Fixed advance widths genuinely help addresses, hashes and block numbers. |
| Body copy | **Geist Sans** | Monospace measurably slows prose reading, so paragraphs are deliberately not mono. |

**On Mingray Mono.** It was the requested face and it is a good fit, but it is a
paid retail font (Rekord, around $39 per style, web licence separate). It is not
bundled here. Martian Mono is the free OFL substitute with the closest
proportions. If a licence is bought, swapping it in means editing `app/layout.tsx`
only: point `--font-display` and `--font-mono` at the new face and nothing else
changes.

Two display utilities exist so the extreme treatment stays rare:

- `display` — uppercase, weight 800, tracking `-0.055em`, line height `0.86`.
  Used by the hero headline and nothing else.
- `display-sm` — same face, weight 700, calmer tracking. Every section heading.

---

## The token layer

`app/globals.css` holds the whole palette. Tailwind v4 is CSS-first here, so there
is no config file: `@theme inline` turns every token into a utility, which is why
components use `bg-surface` and `text-ink-muted` instead of hard-coded hex.

**The primary theme is a deep green canvas**, `#052E29`, in the same family as the
brand `#003C38`. It lives on `:root`, so it is the default and does not follow the
system preference: the green is the brand, not a mode. `.light` is a green-tinted
off-white alternate at `#F1F6F4`, chosen over pure white so the two themes read as
one family rather than two products.

Ink is a pale ice blue, `#D6ECF5`, rather than white. Pure white on saturated
green vibrates.

**One warm colour.** `--flare` (`#FF7A2F`) is the only warm token, reserved for the
hero object and the occasional highlight. It is what stops the page reading as
monochrome, and it is deliberately scarce.

**Semantic names, not colour names.** `--ink`, `--ink-muted`, `--surface-2`,
`--brand-soft`. A component asks for the role it needs, so a palette change never
means touching component code.

**Seven gradients.** `dawn`, `aurora`, `deep`, `canopy`, `sand`, `dusk` and
`flare`, each exposed as a utility. The first six are derived from the teal family
so the set reads as one system. `GlassCard` switches to light ink automatically on
the dark ones.

**Utilities.** `grid-backdrop`, `glass`, `label-xs`, `display`, `display-sm`,
`page-container`.

### Contrast

`npm run check:contrast` parses both palettes straight out of `globals.css` and
asserts every text-on-surface pair against WCAG AA: 4.5:1 for body text, 3:1 for
micro labels and the focus ring. It runs 50 checks and exits non-zero on failure,
so a palette edit cannot quietly break legibility.

Three pairs failed during the first light-theme pass and were fixed rather than
waived, by darkening the light accent and border and lifting the dark brand.

---

## Components

Thirteen, all in `components/ui/`, exported through one barrel.

| Component | Notes |
|---|---|
| `Button` | 5 variants, 3 sizes, loading state that keeps its width. Min height 36px. |
| `Input` | Label, hint, error, `mono` for addresses. `aria-invalid` and `aria-describedby` wired. |
| `Select` | Native `<select>`, restyled. Keyboard and mobile picker behaviour for free. |
| `GlassCard` | Solid, frosted, or any gradient. Optional hover lift. |
| `Badge` | 7 tones, optional monospace. |
| `RoleChip` | `ADMIN` / `MANAGER` / `AUDITOR` / `USER` / `NONE`, with optional expiry. |
| `VerificationBadge` | `verified` / `pending` / `unverified` / `revoked` / `tampered`. Wraps when it carries hint text. |
| `Modal` | Focus trap, focus restore, Escape, scroll lock, `aria-modal`, portal. |
| `Toast` | Provider plus `useToast`. Polite live region, assertive for errors, timers pause on hover. |
| `Skeleton` | Line, block, circle. `aria-hidden`, paired with `SkeletonLabel`. |
| `NetworkChip` | Resolves 31337 / 11155111 / 1, and flags a chain mismatch. |
| `WalletPill` | Identicon, truncated address or ENS name, optional disconnect. |
| `Identicon` | Deterministic. FNV-1a seed into xorshift32, 5x5 mirrored grid, minimum density floor. |

`RoleChip` and `VerificationBadge` carry shape as well as colour, so the state is
still readable without colour vision.

### Accessibility decisions worth keeping

- `useMounted` in `lib/use-mounted.ts` uses `useSyncExternalStore` rather than a
  `useState` plus `useEffect` pair. Same result, no state write inside an effect.
- Every animated component reads `useReducedMotion`. `globals.css` also collapses
  animation and transition durations under `prefers-reduced-motion`.
- Focus is a visible 2px ring at a 2px offset, set once globally.
- `html` carries `scroll-padding-top` so an anchor never lands under the header.

---

## Landing page

`app/page.tsx` composes six sections plus the announcement strip. Only the ones
that animate or hold state are client components; the footer and most copy render
on the server.

| Section | What it does |
|---|---|
| `SiteHeader` | Minimal: brand, one dark pill action, a menu button. Nav, network chip and theme toggle live in the sheet. |
| `Hero` | Full viewport. Label, three oversized lines, one sentence, one action, and the stone. |
| `HowItWorks` | The six lifecycle steps, each one an onchain event. |
| `SplitExplainer` | On-chain versus off-chain, and the integrity check. |
| `Capabilities` | The four design decisions, each shown with the component that represents it. |
| `Evidence` | 93 / 86 / 13 / 3, the proven security assertions, honest phase status. |
| `SiteFooter` | Closing call to action on the `deep` gradient, link columns, disclaimer. |
| `AnnouncementBar` | Bottom-left update strip. Labelled region, dismissal remembered for the session. |

### The hero object

`components/landing/hero-object.tsx` is a brilliant-cut diamond rising through the
bottom edge. Geometry follows a real cut so it reads as one solid object: a flat
table, a girdle at the widest point, and a pavilion running to a culet below the
fold. Facets are flat fills with no gradients and lighting is faked purely by tone,
which is what makes it look cut rather than drawn. Seams are stroked in the page
colour. It echoes the diamond in the owneX mark, and it settles once on load rather
than looping so nothing competes with the headline.

An earlier version split into two wings and read as a butterfly. It was rebuilt.

### The on-chain versus off-chain explainer

`components/landing/split-explainer.tsx` is the diagram the privacy claim rests on:
what the chain holds on the left, what stays encrypted on the right, and a
`keccak256` bridge between them. The integrity check alternates between a matching
hash and a tampered one, because the mismatch case is the point.

---

## Verification

```bash
cd apps/platform
npm run check:contrast   # 50 WCAG checks across both themes
npm run lint             # clean
npm run typecheck        # clean
npm run build            # clean
```

Rendered checks against a running `npm start`:

- `node scripts/diagnose-overflow.mjs` reports every element wider than the
  viewport. It caught a real bug: `VerificationBadge` with hint text was
  `whitespace-nowrap` inside a non-wrapping row, pushing the mobile page 5px wide.
  Fixed at source in both the badge and the row.
- `node scripts/shots.mjs` captures the landing page and `/design` in both themes
  at 1440 / 834 / 390. No console errors, no page errors, no horizontal overflow.
- Primary theme resolves to `rgb(5,46,41)`, light to `rgb(241,246,244)`.

---

## `/design`

A living reference at `/design` renders every component and every state, including
the ones the landing page does not use (`Modal`, `Toast`, `Skeleton`, the error
field state, the wrong-network chip). Phase 5 should build against this page.

---

## Known gaps

- **Nothing is wired to a wallet yet.** "Get started" and the connect actions are
  presentational. The SIWE flow already exists in the API from Phase 3; hooking the
  button to it is Phase 5.
- **The network chip is hard-coded to 31337.** It becomes live once a wallet
  provider is connected.
- **`Toast` and `Modal` are only mounted on `/design`.** The dashboard shell in
  Phase 5 should mount `ToastProvider` once, high in the tree.
- **No visual regression baseline.** `scripts/shots.mjs` captures screenshots but
  nothing diffs them between runs yet.
- **Mingray Mono is not licensed.** Martian Mono stands in. See the type section.
