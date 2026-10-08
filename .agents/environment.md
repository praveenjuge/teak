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

Bun (`packageManager`) and Node (`engines.node`) follow one policy: the
pinned version is exact, patch drift warns, and minor/major drift fails.
Setup and doctor enforce it locally; the CLI release workflow enforces the
same pins via `bun-version-file: package.json` and
`node-version-file: package.json`, so local and CI never disagree about the
toolchain.

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

A local backend's auth config reads `WORKOS_API_BASE_URL`, and Convex refuses
an auth config that reads an unset variable, so setup always sets it:
production WorkOS by default, or the WorkOS emulator's loopback origin when
exported. Setup checks both values and never puts a loopback origin on a
cloud deployment. Hosted deployments never read it. If a push fails on this
variable, re-run `bun run setup`; it names the bad value and the fix.

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

## Files storage: current shared state and isolated target

Convex dev currently shares the production Files Worker, `teak-files-prod`
bucket, signing key and S3 credentials, separated only by
`R2_KEY_PREFIX=dev/`. The prefix protects canonical paths; it does not limit
credential authority. The prepared target is the `teak-files-development`
Worker (`apps/files-worker/development/wrangler.jsonc`) on
`teak-files-development-20261006`, with its own signing key, bucket-scoped
credentials and the same `dev/` prefix and exact keys. Production values never
change.

`check:cloudflare` recognizes both states and blocks any mix. In the isolated
state it also blocks a dev signing key or S3 credential equal to production.
Run it without `--only` to compare credentials. Distinct values do not prove
provider permission scope.

Source changes activate nothing. `deploy:development` bootstraps the
development Worker before the switch. It is unguarded by Convex state, and its
config can only reach the development bucket, namespace and workers.dev. The
approved switch then changes the dev Convex `FILES_BASE`,
`FILES_SIGNING_SECRET`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY` together. Web, packaged desktop and shared media
recovery already trust exactly `https://teak-files-development.praveenjuge.workers.dev`
when built for the dev deployment, so no `NEXT_PUBLIC_FILES_BASE` is needed.
Only after the switch do `bun run sync:cloudflare-dev --isolated` (writes the
ignored `apps/files-worker/development/.dev.vars`) and
`bun run --cwd apps/files-worker dev:development` run. Both read the pinned dev
deployment by name, with every ambient Convex selector blanked, and refuse the
shared state. Never copy production credentials into isolated development.
