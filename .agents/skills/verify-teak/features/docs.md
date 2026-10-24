# Docs site

teakvault.com's docs, built from `apps/docs/content` with Blume. The sidebar groups pages under Apps, Data, Developers, Open Source and Legal, after the top-level Welcome, Features and Support pages. Every page has a Markdown mirror at its URL plus `.md`, and `llms.txt` and `llms-full.txt` list the site for agents. Text inside `<Visibility for="agents">` shows only in those mirrors, never on the web page.

## Sub-features

- `docs-sidebar` lists the groups in order (Apps, Data, Developers, Open Source, Legal), each with its pages in the order its `meta.ts` gives.
- `docs-page` renders a page's title, description, body and "On this page" outline, in light and dark, without horizontal page scroll at 390px.
- `docs-agent-visibility` keeps `<Visibility for="agents">` text out of the web page and puts it in the page's `.md` mirror and `llms-full.txt`.
- `docs-links` resolves every internal link and anchor (`blume validate --strict`, `blume audit`).

## How to get to it (user POV)

- Locally: `bun run dev docs` (or `bun run --cwd apps/docs dev`), then `http://localhost:3001/docs` (a worktree prints its own docs port in `bun run dev --status`).
- Production: `https://teakvault.com/docs`.
- A page's Markdown: its URL plus `.md`, such as `/docs/testing.md`.
- The built site, with `llms.txt` and `llms-full.txt`: `bun run --cwd apps/docs build:site`, then `bunx blume preview` in `apps/docs`.

## Driving it with e2e MCP and curl

Preconditions:

- The docs dev server answers `200` at `/docs` on its port. It needs no sign-in and no backend.

Steps:

- **Sidebar.** `open_session` on `http://localhost:3001/docs/architecture`. The sidebar shows, in order: "Welcome to Teak", "Features", "Support", then the group "Apps" (Mac App, Mobile App (iOS), Browser Extensions, Raycast Extension, Command Line), "Data" (Import Your Data, Export Your Data), "Developers" (API, API Quickstart, TypeScript SDK, MCP, WebMCP, Teak for AI Agents), "Open Source" (Development Guide, Architecture, Testing, Adding a Feature, Translating, Self-Hosting) and "Legal". The current page is highlighted and its breadcrumb names its group.
- **Page.** Open each page a change touches. The heading matches its frontmatter `title`, the description shows under it, and "On this page" lists its H2 headings. Repeat in dark (`colorScheme: "dark"`) and at 390px, where `document.documentElement.scrollWidth` stays at most the window width; wide tables scroll inside their own box.
- **Agent text.** On `/docs/testing`, the page has no "Notes for agents" section. `curl -s http://localhost:3001/docs/testing.md | grep "Notes for agents"` finds it. Do the same for any page whose `Visibility` block the change touches.
- **Links.** `bun run --cwd apps/docs typecheck` (strict check and validate) and `bun run --cwd apps/docs build` (build and audit) both pass.

## Gotchas

- `blume validate --strict` fails with `BLUME_SHALLOW_GIT_HISTORY` while a page is new and uncommitted, because it has no git date yet. Commit, then validate.
- The dev server doesn't serve `llms.txt` or `llms-full.txt`; read them from a build (`apps/docs/dist`) or a preview.
- Group folders in parentheses, such as `(open-source)`, add no URL segment: moving a page between groups keeps its URL. Renaming the file changes it, so add a redirect in `blume.config.ts`.
- `/api` and `/mcp` on the docs dev server proxy to the development deployment; the API, CLI and MCP recipe ([api-cli-mcp](./api-cli-mcp.md)) covers them.
