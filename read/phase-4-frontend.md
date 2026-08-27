# Phase 4 — Design system + landing page

Everything the interface is built from, plus the first page a visitor sees.
Phase 5 assembles the dashboard out of these parts, so this phase is deliberately
about the system rather than the screens.

```
44 contrast checks passing  ·  lint clean  ·  typecheck clean  ·  production build clean
```

---

## The token layer

`app/globals.css` holds the whole palette. Light is the primary theme and dark is
opt-in, so `:root` carries the white canvas and `.dark` inverts it. Tailwind v4 is
CSS-first here, so there is no config file: `@theme inline` turns every token into
a utility, which is why components use `bg-surface` and `text-ink-muted` instead
of hard-coded hex.

**Brand.** `#003C38`, a deep teal, on white. In dark mode the brand lifts to
`#14A091` so it stays legible against near-black, and `--accent` becomes the mint
`#5CF2D6`. Nothing in a component hard-codes a colour.

**Semantic names, not colour names.** Tokens are `--ink`, `--ink-muted`,
`--surface-2`, `--brand-soft`, and so on. A component asks for the role it needs,
so a palette change never means touching component code.

**Six named gradients.** `dawn`, `aurora`, `deep`, `canopy`, `sand`, `dusk`, each
exposed as a utility (`gradient-deep`). They are all derived from the teal family
rather than picked independently, so the set reads as one system. `aurora`,
`deep`, `canopy` and `dusk` are dark in both themes, so `GlassCard` switches to
light ink automatically when one is applied.

**Radii, shadows, fonts.** `--radius-xs` through `--radius-2xl`, three shadow
depths plus a brand glow, and Geist Sans and Geist Mono wired to `--font-sans`
and `--font-mono`. Monospace is reserved for addresses, hashes and block numbers.

**Utilities.** `grid-backdrop` (the engineering grid), `glass` (frosted surface),
`label-xs` (uppercase micro label), `display` (oversized heading treatment) and
`page-container` (one max width for every section).

### Contrast

`npm run check:contrast` parses the two palettes straight out of `globals.css` and
asserts every text-on-surface pair against WCAG AA: 4.5:1 for body text, 3:1 for
micro labels and the focus ring. It runs 44 checks across both themes and exits
non-zero on failure, so a palette edit cannot quietly break legibility.

Three pairs failed on the first run and were fixed rather than waived:

| Pair | Was | Now |
|---|---|---|
| light `accent` on `brand-soft` | 4.38:1 | 4.90:1 |
| light `border` on `surface` | 1.28:1 | 1.35:1 |
| dark `brand` on `brand-soft` | 4.07:1 | 5.18:1 |

---

## Components

Thirteen, all in `components/ui/`, exported through one barrel.

| Component | Notes |
|---|---|
| `Button` | 5 variants, 3 sizes, loading state that keeps its width. Min height 36px. |
| `Input` | Label, hint, error, `mono` for addresses. `aria-invalid` and `aria-describedby` wired. |
| `Select` | Native `<select>`, restyled. Keyboard and mobile picker behaviour for free. |
| `GlassCard` | Solid, frosted, or any of the six gradients. Optional hover lift. |
| `Badge` | 7 tones, optional monospace. |
| `RoleChip` | `ADMIN` / `MANAGER` / `AUDITOR` / `USER` / `NONE`, with optional expiry. |
| `VerificationBadge` | `verified` / `pending` / `unverified` / `revoked` / `tampered`. |
| `Modal` | Focus trap, focus restore, Escape, scroll lock, `aria-modal`, portal. |
| `Toast` | Provider plus `useToast`. Polite live region, assertive for errors, timers pause on hover. |
| `Skeleton` | Line, block, circle. `aria-hidden`, paired with `SkeletonLabel`. |
| `NetworkChip` | Resolves 31337 / 11155111 / 1, and flags a chain mismatch. |
| `WalletPill` | Identicon, truncated address or ENS name, optional disconnect. |
| `Identicon` | Deterministic from an address. FNV-1a seed into xorshift32, 5x5 mirrored grid. |

`RoleChip` and `VerificationBadge` carry shape as well as colour, so the state is
still readable without colour vision.

### Accessibility decisions worth keeping

- `useMounted` in `lib/use-mounted.ts` uses `useSyncExternalStore` rather than a
  `useState` plus `useEffect` pair. Same result, no state write inside an effect,
  and it satisfies `react-hooks/set-state-in-effect`.
- Every animated component reads `useReducedMotion` and drops to a duration of
  zero. `globals.css` also collapses animation and transition durations under
  `prefers-reduced-motion`, so third-party motion is covered too.
- Focus is a visible 2px accent ring at a 2px offset, set once globally.
- `html` gets `scroll-padding-top` so an anchor never lands under the sticky
  header.

---

## Landing page

`app/page.tsx` composes six sections. Only the ones that animate or hold state are
client components; the shell, hero copy and footer render on the server, so the
first paint is HTML and there is no layout shift.

| Section | What it does |
|---|---|
| `SiteHeader` | Sticky, turns to glass past 16px of scroll. Nav, theme toggle, network chip, mobile sheet. |
| `Hero` | Headline, actions, the real project numbers, and the node-and-edge mesh. |
| `HowItWorks` | The six lifecycle steps, each one an onchain event. |
| `SplitExplainer` | On-chain versus off-chain, and the integrity check. |
| `Capabilities` | The four design decisions, each shown with the component that represents it. |
| `Evidence` | 93 / 86 / 13 / 3, the proven security assertions, and honest phase status. |
| `SiteFooter` | Closing call to action on the `deep` gradient, link columns, disclaimer. |

### The mesh

`components/landing/mesh-backdrop.tsx` draws the identity graph: eight nodes for
the organisation, its identities and its assets, twelve edges for the permission
and custody links, and a signature travelling from an identity through the
organisation to an asset. Node positions are fixed rather than random so the
server and client markup match. Only transforms and opacity animate.

### The on-chain versus off-chain explainer

`components/landing/split-explainer.tsx` is the diagram the whole privacy claim
rests on: what the chain holds on the left, what stays encrypted on the right, and
a `keccak256` bridge between them. The integrity check alternates between a
matching hash and a tampered one, because the mismatch case is the point.

---

## Verification

```bash
cd apps/platform
npm run check:contrast   # 44 WCAG checks across both themes
npm run lint             # clean
npm run typecheck        # clean
npm run build            # clean, / and /design prerendered
```

Rendered checks, via `node scripts/shots.mjs` against a running `npm start`:

- Landing page and `/design`, both themes, at 1440 / 834 / 390.
- No console errors and no page errors in any of the twelve combinations.
- No horizontal overflow at any width.
- Light resolves to `rgb(255,255,255)`, dark to `rgb(6,9,8)`, confirming light is
  the default.

---

## `/design`

A living reference at `/design` renders every component and every state, including
the ones the landing page does not use (`Modal`, `Toast`, `Skeleton`, the error
field state, the wrong-network chip). Toggle the theme in its header to check both
palettes. Phase 5 should build against this page.

---

## Known gaps

- **Nothing is wired to a wallet yet.** "Connect wallet" and "Launch owneX" are
  presentational. The SIWE flow already exists in the API from Phase 3; hooking
  the button to it is Phase 5.
- **The network chip is hard-coded to 31337** on the landing page. It becomes live
  once a wallet provider is connected.
- **`Toast` and `Modal` are only mounted on `/design`.** The dashboard shell in
  Phase 5 should mount `ToastProvider` once, high in the tree.
- **No visual regression baseline.** `scripts/shots.mjs` captures screenshots but
  nothing diffs them between runs yet.
