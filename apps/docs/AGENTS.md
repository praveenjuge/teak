# Documentation conventions

## Synchronization contract

Keep user documentation synchronized in the same change:

- Public API contracts in `packages/convex/http.ts`, `publicApiHttp.ts`, `publicApiMeta.ts`, or `publicApiOpenApi.ts` -> `content/docs/(developers)/api.mdx`
- MCP behavior under `packages/convex/mcp` -> `content/docs/(developers)/mcp.mdx`
- Raycast commands or authentication -> `content/docs/(apps)/raycast.mdx`
- CLI or public SDK behavior under `apps/cli` or `packages/convex/client/sdk.ts` -> `content/docs/(apps)/cli.mdx`
- Public skills under `.agents/skills` -> `content/docs/(developers)/ai-agents.mdx` and `pages/apps.astro` (`/docs/skills` redirects to `/docs/ai-agents`)

For a notable, shipped product change, update its calendar month's entry in `content/changelog`. Keep one changelog entry per month. Internal maintenance and marketing page changes need no public entry.

## Changelog entries

`content/changelog` is a public product surface. Write for Teak users, not maintainers.

- Keep one file and one published entry for each month with notable shipped changes, named `month-yyyy.mdx` (for example, `september-2026.mdx`). Leave months without qualifying changes empty. Update the existing file as changes ship; set its `date` to the latest included ship date. Check for another entry with the same month and year before editing.
- Include meaningful changes to what people can do, how a workflow behaves, reliability they can notice, or actions they must take. Leave out landing page and marketing copy or layout, internal maintenance, dependencies, refactors, tests, CI, schemas, migrations, and release mechanics.
- Lead with the user outcome and explain where it applies and why it matters. Group related changes under short, descriptive headings when a month spans several workflows. Merge overlapping updates and prioritize the most useful details; there is no fixed bullet count.
- For a breaking change or required action, state who is affected, what to do, and link the relevant guide. Link documentation for new or changed workflows when it helps readers take the next step.
- Use product language. Names users recognize, such as web, desktop, mobile, browser extension, Raycast, API, MCP, Settings, and sign-in, are appropriate. Avoid implementation details, claims not verified in the shipped product, and repeated release-note boilerplate.

An entry is complete when its month is unique, every item is useful to a Teak user, and required actions are clear.
