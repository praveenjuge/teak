## Goal

Make sure agents can discover the Teak Agent Skill from the web: `/.well-known/agent-skills/index.json` lists the `teak` skill with a SHA-256 digest that matches the published `SKILL.md`. The serving already ships, so this phase locks it in with checks and fixes the gaps. Phase 9 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing.

## Success Criteria

- `https://teakvault.com/.well-known/agent-skills/index.json` returns valid JSON matching discovery schema 0.2.0, with `access-control-allow-origin: *`. Its single `teak` entry's `digest` equals the SHA-256 of the bytes served at its `url`.
- `https://api.teakvault.com/.well-known/agent-skills/index.json` reaches the same index (today through a permanent redirect).
- A broken skill fails a check before it ships:
  - missing or invalid front matter
  - a `name` that doesn't match its directory
  - a description over 1,024 characters
  - a skill that is no longer published
- After every docs deploy, a check fails if the live digest doesn't match the repository's `.agents/skills/teak/SKILL.md`.
- `ai-agents.mdx` documents both addresses.

## Context And Current Facts

- **Already shipped:** the docs site serves the index through Blume.
  - `apps/docs/scripts/generate-skills.ts` copies `PUBLIC_SKILLS = ["teak"]` from `.agents/skills` to `apps/docs/.generated/agent-skills` (ignored by git). `bun run generate` runs it, before `build:site`, `dev`, `typecheck` and `validate`.
  - `apps/docs/blume.config.ts` sets `agents.skills: "./.generated/agent-skills"`.
  - Blume 2.2.1 (`node_modules/blume/dist/types/ai/skills.d.ts`) follows the Agent Skills Discovery RFC v0.2.0. It publishes a skill made of one file as `type: "skill-md"` with a `sha256:` digest, and a skill with extra files as a `.tar.gz` archive. An invalid skill is skipped with a build warning, not an error.
- **Checked live on 2026-10-14:**
  - `teakvault.com/.well-known/agent-skills/index.json` returns 200, `application/json`, `access-control-allow-origin: *` and `cache-control: public, max-age=0, must-revalidate`. It lists `teak` with digest `sha256:498ee4cf…c023` and url `/.well-known/agent-skills/teak/SKILL.md`. The served file's SHA-256 matches the repository's `SKILL.md`.
  - `api.teakvault.com/.well-known/agent-skills/index.json` returns a Cloudflare **308** to the teakvault.com URL. That redirect is set in Cloudflare, not in this repository.
- `content/docs/(developers)/ai-agents.mdx` (lines 57 and 93) already lists the teakvault.com index address.
- The Convex HTTP router (`packages/convex/http.ts`) serves only `/.well-known/teak-oauth-clients.json` and `/.well-known/oauth-protected-resource[/mcp]`. `apps/docs/vercel.json` proxies those to Convex. `apps/docs/middleware.ts` skips `/.well-known/`.
- Production probes live in `packages/tests/src/docs/extra-prod-surfaces.e2e.ts`. They cover `/.well-known/mcp.json` and the api.teakvault.com health and OpenAPI endpoints, but not the skills index.
- `apps/docs` unit tests run with `bun test lib` (testing.md: `apps/docs` tests are `lib/**`).

## Constraints And Non-goals

- No Convex route. The approved plan put a second copy in `http.ts`, but the redirect already covers the API domain, and a copy built into Convex could drift from the docs copy.
- No change to the skill's content in this phase. Updating it for new v2 features belongs to the phases that ship those features.
- Only `teak` is published. Contributor skills in `.agents/skills` stay private (`PUBLIC_SKILLS`).

## Backend

- None.

## Web

- None.

## API / MCP / SDK / CLI

- None. Document the api.teakvault.com redirect in `.agents/environment.md` (or wherever Cloudflare rules are recorded), so it isn't removed by accident.

## Docs

- `apps/docs/lib/agentSkills.ts`: a pure `validatePublicSkill(dir, markdown)`. It checks the front matter for `name` and `description`, that the name equals the directory, and that the description is at most 1,024 characters. It returns readable errors.
- `apps/docs/scripts/generate-skills.ts`: calls `validatePublicSkill` for every entry in `PUBLIC_SKILLS`, and exits non-zero on an error, so the build fails instead of Blume silently skipping the skill.
- `content/docs/(developers)/ai-agents.mdx`: a short "Discovery" note that names both addresses and the digest check. No changelog entry: this changes nothing a user sees (`apps/docs/AGENTS.md`).

## UI states

- Not applicable; there is no UI. The "states" are HTTP responses:
  - **Empty:** an index with no skills fails the probe.
  - **One / many items:** today one skill. A second public skill must also pass the digest check.
  - **Error:**
    - A 404 for the artifact, or a digest mismatch, fails the probe.
    - A missing CORS header fails the probe.
  - **Rate-limited:** not applicable (static files on Vercel).

## Scenario seed packs

- No Convex seed. Fixtures for `apps/docs/lib/agentSkills.test.ts`:
  - a valid `SKILL.md`
  - no front matter
  - a mismatched `name`
  - a 1,025-character description
  - CRLF line endings
  - a BOM
  - a skill directory with an extra file (published as an archive)

## Break-it checklist

- Change one byte of `SKILL.md` without redeploying the docs: the post-deploy probe fails with the expected and actual digests.
- Remove `teak` from `PUBLIC_SKILLS`: the probe fails.
- Break the front matter: `generate-skills` fails the build.
- `curl -sSI` both domains and check the status, `content-type`, CORS and caching headers. Follow the 308 with `-L`.
- Request `/.well-known/agent-skills/teak/SKILL.md` with `Accept: text/markdown`: the middleware must not intercept it.

## Tests

- `apps/docs/lib/agentSkills.test.ts`: a `test.each` over the fixtures above, plus the real `.agents/skills/teak/SKILL.md`, which must pass.
- `packages/tests/src/docs/extra-prod-surfaces.e2e.ts`:
  - Add probes for `${published.siteUrl}/.well-known/agent-skills/index.json` (json, `/skills/`) and for the api.teakvault.com address with redirects followed.
  - Add a test that fetches the index, fetches each artifact, compares the SHA-256 with `digest`, and checks `access-control-allow-origin`.

## Proof before the PR

- Captured terminal output:
  - `curl -sSi` for both index addresses and the `SKILL.md`
  - `shasum -a 256` of the served file next to the index digest
  - a failing `generate-skills` run on a broken fixture
  - the passing e2e probe run
- Screenshots: the updated `ai-agents.mdx` section, light and dark, at 390px and 1440px.

## Release gate

1. Run the narrow tests (`bun run --cwd apps/docs test`), then `bun run --cwd apps/docs build`, the repo checks and the docs e2e probes.
2. Run the break-it pass above, then fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge. Vercel deploys the docs. Run the production probes. No backfill, and no Convex or worker deploy.

## Risks And Open Questions

- **Mostly shipped already.** Most of what the approved plan asked for is live. The owner may prefer to fold these checks into another docs PR rather than spend a phase on them.
- **The redirect.** The api.teakvault.com address depends on a Cloudflare redirect rule outside the repository. If that rule changes, the probe catches it, but only after deploy.
- **Blume skips silently.** Blume skips an invalid skill without failing the build. The new `validatePublicSkill` step closes that gap, and must stay in step with Blume's own rules when Blume is upgraded.
