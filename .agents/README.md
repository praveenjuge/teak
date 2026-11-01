# .agents

What agents need that isn't for the public site: Teak's own deployments,
credentials, runbooks and records, plus the skills agents load. Root
`AGENTS.md` says when to read each file; this is the full list.

How Teak is built, run, tested, contributed to and translated is public, in
`apps/docs/content/docs/(open-source)/`: `development.mdx` (including cloud
sessions and pull requests), `architecture.mdx` (including each workspace's
rules and search by meaning), `testing.mdx`, `adding-a-feature.mdx` (including
docs and the changelog), `translating.mdx` and `self-hosting.mdx`. Notes only
agents need go inside `<Visibility for="agents">` there, not here. Before you
add a file here, check that it isn't something a contributor or self-hoster
would need too.

## Guides: reference for Teak's own deployments

| File | Read it when you |
| --- | --- |
| `guides/analytics.md` | add an event or touch PostHog telemetry |
| `guides/environment.md` | add or debug a credential or Files storage on Teak's own deployments |

## Runbooks: step-by-step work on Teak's own deployments

| File | Read it when you |
| --- | --- |
| `runbooks/releases.md` | prepare any release, or release the CLI or SDK |
| `runbooks/self-driving.md` | run the daily production check or the weekly guide audit |
| `runbooks/claude-directory.md` | submit or update Teak's listing in Claude's directory (connector and plugin) |
| `runbooks/convex-costs.md` | run Convex maintenance, retention, or a raw-metadata migration |

## Records

| File | Read it when you |
| --- | --- |
| `records/sunset.md` | keep code only for old clients or old data, or remove some; look up a finished migration |

Every file in `guides/`, `runbooks/` and `records/` starts with a
`Last reviewed: YYYY-MM-DD` line; update it when you check the file against
the code. `scripts/repo/agent-guide-paths.test.ts` fails when the line is
missing or a path in any guide no longer exists, and the self-driving run's
weekly audit (`runbooks/self-driving.md`, "Mondays") rechecks the oldest ones.

Plans for unshipped work don't live here: put a plan in its pull request or
issue, and let git history keep it.

## Skills

`skills/` holds the skills agents load. `.claude/skills` links here, so
Claude Code loads the same skills, in cloud sessions too.

Teak's own, edited here:

- `teak`: using the product through its API, MCP, SDK and CLI. The docs build
  publishes it.
- `verify-teak`: proving a change in the running app: launch, doctor
  (`.agents/skills/verify-teak/scripts/doctor.ts`, not the root
  `scripts/setup/doctor.ts`), drive, evidence, cleanup, with a feature map in
  `features/`. Every user-facing change updates its map. Its "Reporting back"
  section is what a delegated verifier returns.
- `teak-convex-backend` (`packages/convex`) and `teak-core-worker`
  (`apps/core-worker`): the rules and proof steps for those workspaces.
- `teak-release`: releasing every product from one prompt, in order, with
  what went wrong last time; the runbooks stay the source for each product.

Vendored, installed with `npx skills` and pinned in the root
`skills-lock.json` (`scripts/repo/skills-drift.test.ts` checks them). Update
them with `npx skills`, not by hand, then delete the `evals/` and `agents/`
folders the installer adds; the drift test fails while they're there.

- Cloudflare: `wrangler`, `workers-best-practices`, `durable-objects` and
  `cloudflare-email-service`, from `cloudflare/skills`
  (`npx skills add cloudflare/skills -s <name> -a codex -y`). They tell agents
  to read current Cloudflare docs rather than trust memory; `.mcp.json`
  registers Cloudflare's docs MCP server (`cloudflare-docs`, no sign-in).
- Convex: `convex` and the `convex-*` skills. WorkOS: `workos`. UI and
  tooling: `shadcn`, `ultracite`, `e2e`.
- Verification: `principle-prove-it-works`, `create-verification-skill` and
  `maintain-verification-skill`, from pstack (`cursor/plugins`). They are
  written for Cursor. Their first line points at a Claude Code adapter this
  repo doesn't vendor; read the
  [adapter](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md)
  instead. In Teak, a generated verification skill lives in `.agents/skills/`,
  not `.cursor/skills/`.

## Other files

- `setup`: prepares a fresh Linux VM (`development.mdx`, "Cloud agents").
- `resume`: restores the toolchain PATH when Amp resumes a VM.
- `hooks/session-start.sh`: the Claude Code SessionStart hook.
- `hooks/start-docker.sh`: starts Docker in a cloud session; the
  SessionStart hook runs it (`development.mdx`, "Cloud sessions in detail").
- `hooks/format-edited.ts`: the PostToolUse hook that formats edited files.
- `.state/`: ignored runtime state for the running stack (`stack.json`,
  `stack.log`, the dev account).
