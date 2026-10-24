# .agents

Guides, plans and skills for agents working in Teak. Root `AGENTS.md` says
when to read each guide; this is the full list.

How Teak is built, run, tested and translated is public, in
`apps/docs/content/docs/(open-source)/`: `development.mdx`,
`architecture.mdx`, `testing.mdx`, `adding-a-feature.mdx`, `translating.mdx`
and `self-hosting.mdx`. A guide here holds only what isn't for the public site:
Teak's own deployments, credentials, runbooks and records.

## Guides

| File | Read it when you |
| --- | --- |
| `cloud.md` | work in a cloud session (Claude Code on the web, Codex, Amp) |
| `environment.md` | add or debug a credential or Files storage on Teak's own deployments |
| `analytics.md` | add an event or touch PostHog telemetry |
| `semantic-search.md` | touch embeddings, Vectorize, or search by meaning |
| `pull-requests.md` | open a PR or post on GitHub |
| `releases.md` | prepare any release |
| `convex-costs.md` | run Convex maintenance, retention, or a raw-metadata migration |
| `self-driving.md` | run the daily production check (it holds that routine's log) |
| `migrations/workos/README.md` | touch the retained Better Auth data or Connect disconnects |
| `sunset.md` | keep code only for old clients or old data, or remove some |

## Plans

`plans/` holds plans for work that hasn't shipped. Each phase plan lists its
goal, decisions and verification. Delete a plan in the PR that finishes it;
git history keeps it. Before starting one, check its "facts" against the code,
since they were true when it was written.

## Skills

`skills/` holds the skills agents load. The vendored ones are installed with
`npx skills` and pinned in the root `skills-lock.json`
(`scripts/skills-drift.test.ts` checks them); update those with `npx skills`,
not by hand. `teak` is Teak's own skill for using the product through its API,
MCP, SDK and CLI. It is edited here, and the docs build publishes it.
`.claude/skills` links here, so Claude Code loads the same skills, in cloud
sessions too (plugins from a person's own settings don't load there).

Cloudflare: `wrangler`, `workers-best-practices`, `durable-objects` and
`cloudflare-email-service` are vendored from `cloudflare/skills`
(`npx skills add cloudflare/skills -s <name> -a codex -y`). They tell agents
to read current Cloudflare docs rather than trust memory.

Verification (root `AGENTS.md`, "Verification"):

- `verify-teak` is Teak's own skill for proving a change in the running app:
  launch, doctor (`.agents/skills/verify-teak/scripts/doctor.ts`, not the
  root `scripts/doctor.ts`), drive, evidence, cleanup, with a feature map in
  `features/`. It is edited here; every user-facing change
  updates its map.
- `principle-prove-it-works`, `create-verification-skill` and
  `maintain-verification-skill` are vendored from pstack (`cursor/plugins`).
  They are written for Cursor. Their first line points at a Claude Code
  adapter this repo doesn't vendor; read the
  [adapter](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md)
  instead. In Teak, a generated verification skill lives in `.agents/skills/`,
  not `.cursor/skills/`.

## Other files

- `setup`: prepares a fresh Linux VM (`development.mdx`, "Cloud agents").
- `resume`: restores the toolchain PATH when Amp resumes a VM.
- `hooks/session-start.sh`: the Claude Code SessionStart hook.
- `hooks/start-docker.sh`: starts Docker in a cloud session; the
  SessionStart hook runs it (`cloud.md`, "Containers").
- `../.claude/agents/`: Claude Code subagents a session can delegate to:
  `files-worker` (Cloudflare Workers), `convex-backend` (`packages/convex`)
  and `teak-verifier` (runs `verify-teak` and returns the evidence). Each
  points back at the guides here rather than repeating them.
- `.state/`: ignored runtime state for the running stack (`stack.json`,
  `stack.log`, the dev account).
