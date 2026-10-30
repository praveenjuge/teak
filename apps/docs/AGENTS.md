# Documentation conventions

## Synchronization contract

Keep user documentation synchronized in the same change:

- Public API contracts in `packages/convex/http.ts`, `publicApi/http/*.ts`, or `publicApi/openApi/*.ts` -> `content/docs/(developers)/api.mdx`
- MCP behavior under `packages/convex/mcp` -> `content/docs/(developers)/mcp.mdx`
- Apple app behavior under `apps/apple` -> `content/docs/(apps)/mac.mdx` (Mac) and `content/docs/(apps)/mobile.mdx` (iPhone and iPad)
- Raycast commands or authentication -> `content/docs/(apps)/raycast.mdx`
- CLI behavior under `apps/cli` -> `content/docs/(apps)/cli.mdx`
- Public SDK behavior under `packages/sdk/src` -> `content/docs/(developers)/sdk.mdx`
- Public skills under `.agents/skills` -> `content/docs/(developers)/ai-agents.mdx` and `pages/apps.astro` (`/docs/skills` redirects to `/docs/ai-agents`)

The Open Source group is the source of truth for how Teak is built, run and tested; root `AGENTS.md` points agents at these files instead of repeating them:

- Running, setup, doctor, the push lease, worktrees, cloud VMs, or how commands read env values (`scripts/dev*.ts`, `scripts/setup*.ts`, `scripts/doctor.ts`, `scripts/env-*.ts`, `.agents/setup`) -> `content/docs/(open-source)/development.mdx`
- Workspace layout, or how the apps, Convex and the Workers connect -> `content/docs/(open-source)/architecture.mdx`
- Where tests go, testing rules, or the end-to-end stack and suites (`packages/tests`) -> `content/docs/(open-source)/testing.mdx`
- The steps to ship a feature on every surface (`scripts/public-parity.ts`), data, index, backfill, deploy or UI rules -> `content/docs/(open-source)/adding-a-feature.mdx`
- Locales, catalog rules, the glossary, or the i18n lint (`packages/i18n`) -> `content/docs/(open-source)/translating.mdx`
- Worker bindings, vars and secrets (`apps/core-worker/wrangler.jsonc`) or backend env vars (`packages/convex/convex.config.ts`) -> `content/docs/(open-source)/self-hosting.mdx`

Write these pages for contributors and self-hosters. Put notes only agents need inside `<Visibility for="agents">`, which keeps them out of the website but in the `.md` mirrors and `llms.txt`. Teak's own deployments, credentials and runbooks stay in `.agents`.

For a notable, shipped product change, update its calendar month's entry in `content/changelog`. Keep one changelog entry per month. Internal maintenance and marketing page changes need no public entry.

## Docs evals

`evals.yaml` holds the questions Teak users and their agents ask. `bun run eval` has an agent answer each one from these docs alone, then a judge checks the expected facts. Keep every fact true to the shipped product, and never weaken one to get a passing run.

## Changelog entries

`content/changelog` is a public product surface. Write for Teak users, not maintainers.

- Keep one file and one published entry for each month with notable shipped changes, named `month-yyyy.mdx` (for example, `september-2026.mdx`). Leave months without qualifying changes empty. Update the existing file as changes ship; set its `date` to the latest included ship date. Check for another entry with the same month and year before editing.
- Include meaningful changes to what people can do, how a workflow behaves, reliability they can notice, or actions they must take. Leave out landing page and marketing copy or layout, internal maintenance, dependencies, refactors, tests, CI, schemas, migrations, and release mechanics.
- Lead with the user outcome and explain where it applies and why it matters. Group related changes under short, descriptive headings when a month spans several workflows. Merge overlapping updates and prioritize the most useful details; there is no fixed bullet count.
- For a breaking change or required action, state who is affected, what to do, and link the relevant guide. Link documentation for new or changed workflows when it helps readers take the next step.
- Use product language. Names users recognize, such as web, desktop, mobile, browser extension, Raycast, API, MCP, Settings, and sign-in, are appropriate. Avoid implementation details, claims not verified in the shipped product, and repeated release-note boilerplate.

An entry is complete when its month is unique, every item is useful to a Teak user, and required actions are clear.

## Images

Every docs page shows at least one image, and every image comes from `scripts/docs-assets` (its README has the steps). Don't add a screenshot by hand: add a shot to `scripts/docs-assets/shots.ts` and render it, and use the shot's alt text on the page. `scripts/docs-assets/shots.test.ts` fails when a page has no image or an image drifts from the list. The legal pages, Raycast (which shows its store's install button), and the Mac and mobile pages until there are fresh native captures, are the exceptions it names. Features has an image in each main section and in the subsections with their own screens.

Blog posts live in `content/blog` (`type: blog`, `mode: center`, a `date` and `authors`). Each opens with its cover, a shot in `scripts/docs-assets` named after the post's file; `pages/blog/index.astro` lists them. Posts follow the docs' style: plain, specific, and true to the shipped product.
