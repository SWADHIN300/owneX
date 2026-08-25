# read/ — build documentation

One file per phase, written when that phase is finished. Read them in order to
understand how OwneX was built and why.

| File | Contents |
|---|---|
| `PROGRESS.md` | **Live dashboard** — current status, everything remaining, decisions log, blockers |
| `phase-1-contracts.md` | The three Solidity contracts: what each does and why it's shaped that way |
| `phase-2-tests-and-deploy.md` | 93 tests, the deploy script, the demo seed |
| `phase-3-backend.md` | *pending* — Supabase, SIWE auth, role API |
| `phase-4-design-system.md` | *pending* — gradients, components, landing page |
| `phase-5-dashboard.md` | *pending* — the platform application |
| `phase-6-employee-portal.md` | *pending* — the second app, cross-app SSO |
| `phase-7-sepolia.md` | *pending* — testnet deploy and polish |
| `phase-8-submission.md` | *pending* — diagrams, demo video, handover |

## Convention

Each phase file answers five questions:

1. **What was built** — files, functions, tables, screens
2. **How it was verified** — the actual command output, not a claim
3. **Decisions made** — and the reason, so they aren't relitigated later
4. **What it unblocks** — which phase can now start
5. **Known gaps** — what was deliberately left out

## Where to start

If you are picking this project up cold: read `PROGRESS.md` first for status, then
`phase-1-contracts.md` to understand the data model. The root `README.md` has
setup instructions and the demo path.
