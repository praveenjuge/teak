# Environment sources, precedence, and ownership

Every environment value in Teak has one owner and one classification. Names and
metadata live in `scripts/env-contract.ts`; values are never committed,
printed, or pasted into docs.

## Sources

Supported commands (`setup`, `doctor`, `dev`, `audit:env`) run with Bun's
automatic dotenv loading disabled (`--no-env-file`). They read only:

1. Explicit shell exports (CI, `export`, command prefix).
2. The dotenv files declared for the command's target in
   `scripts/env-targets.ts`, read through `scripts/env-loader.ts`.
3. Provider stores: Convex dashboard, Vercel, EAS, Wrangler, GitHub.
4. Generated files written by setup from canonical facts (never hand-edited).

Precedence is top-down: an explicit shell export wins over a dotenv file, and a
dotenv file wins over a generated default. Setup never overwrites a value a
human set.

## Ownership

| Owner | Values | Examples |
| --- | --- | --- |
| Convex dashboard | Backend runtime values | `SITE_URL`, `RESEND_API_KEY` |
| Vercel | Web deployment values | `NEXT_PUBLIC_CONVEX_URL` |
| EAS | Mobile values | `EXPO_PUBLIC_CONVEX_URL` |
| Wrangler / Cloudflare | Worker vars, secrets, bindings | `FILES_SIGNING_SECRET`, `BUCKET` |
| GitHub variables | Non-secret CI values | release SHAs, origins |
| GitHub environment secrets | CI credentials | `CONVEX_DEPLOY_KEY` |
| Target dotenv file | Local-only development values | `apps/web/.env.local` |
| Test scope files | E2E credentials, never build inputs | `.env.e2e.local`, `apps/web/.env.e2e.local`, `.env.production-e2e.local` |

One credential, one writer. Entries that appear in several providers (for
example the shared files signing secret) document the sync direction in the
contract note; the audit rejects unexplained multi-provider credentials.

## Canonical facts and generated aliases

`CONVEX_URL` and `CONVEX_SITE_URL` are the canonical deployment facts;
`SITE_URL` is the canonical app origin. Framework aliases
(`NEXT_PUBLIC_*`, `VITE_PUBLIC_*`, `EXPO_PUBLIC_*`) are generated from them by
setup (see `scripts/env-aliases.ts`). Frameworks require the aliases at build
time, so they stay compatible — but humans never maintain them by hand.

## Legacy root dotenv files

Root `.env*` files are legacy. Supported commands ignore them; the name-only
`scripts/dotenv-audit.ts` still scans them for production selectors because
other tools (editors, ad-hoc CLIs) may load them ambiently. Prefer shell
exports or the target's declared file for new values. Teak never deletes or
rewrites a developer's dotenv files.

## Classifications

- `secret`: credential; name- and shape-validated, never logged.
- `public-config`: non-secret operator value with one provider owner.
- `generated`: derived from a canonical fact or the active deployment.
- `build-metadata`: derived from provider metadata (commit SHA, version).
- `platform-binding`: provisioned by the platform, not operator-supplied.

Classification is derived from contract metadata (see
`scripts/env-classify.ts`) so it cannot drift from the declared fields.

## Runtime versions: exact pin, patch drift warns

Bun (`packageManager`) and Node (`engines.node`, mirrored in `.nvmrc`) follow
one policy: the pinned version is exact, patch drift warns, and minor/major
drift fails. Setup and doctor enforce it locally; CI enforces the same pins
via `bun-version-file: package.json` and `node-version-file: .nvmrc` on the
setup actions, so local and CI never disagree about the toolchain.

Convex Node actions execute under the system Node runtime, which is why Node
is pinned alongside Bun. Bun's `process.version` reports compatibility, not
the toolchain, so the version probes shell out to `node --version`.

## Local backends and worktree concurrency

Convex local deployments bind fixed ports (3210/3211) with no supported way
to move them, so two checkouts cannot both run a local backend. The main
checkout uses the fixed ports; linked worktrees get deterministic web/docs
ports plus a namespace from `scripts/worktree-env.ts`, and select an isolated
cloud development deployment instead of local. Setup refuses a namespaced
local selection when the fixed ports are occupied, with a remediation.

## Stable values live in code, not configuration

Values that do not vary by deployment are typed code with an environment
override, not required inputs. The pattern is a code default plus an optional
override: `packages/tests/src/helpers/env.ts` defaults `E2E_PUBLIC_ORIGIN` to
the production origin, and `scripts/build-metadata.ts` derives release IDs
from provider metadata with a `GIT_SHA` override. Do not add a contract entry
for a value that is constant across deployments.

## Cloud credentials and OIDC (evaluated 2026-09)

- `CONVEX_DEPLOY_KEY` (Backend Deploy): Convex non-interactive auth has no OIDC
  alternative; the deploy key stays, scoped to that workflow's `env` block.
- `EXPO_TOKEN`: used only for manual `eas` runs; no workflow consumes it, so
  there is nothing to migrate. If EAS remote builds move into CI, prefer the
  OIDC flow over a long-lived token.
- Web deploys through the Vercel Git integration with no repository
  credential; App Store and Chrome Web Store credentials are vendor JWT/OAuth
  flows without an OIDC alternative.

## Diagnostics

- `bun run audit:env`: contract-vs-repo audit plus the dotenv audit.
- `bun run scripts/dotenv-audit.ts [--json]`: local dotenv state, names only.
- `bun run doctor --target <t> --profile <p> --json`: readiness with stable
  check IDs, remediations, and redacted output safe to attach to bug reports.
- `bun run scripts/env-contract-report.ts [--json]`: baseline metrics and
  per-target manual-supply counts.
