# Docs site

teakvault.com's docs, built from `apps/docs/content` with Blume. The sidebar groups pages under Apps, Data, Developers, Open Source and Legal, after the top-level Welcome, Features and Support pages. Every page has a Markdown mirror at its URL plus `.md`, and `llms.txt` and `llms-full.txt` list the site for agents. Text inside `<Visibility for="agents">` shows only in those mirrors, never on the web page.

## Sub-features

- `docs-sidebar` lists the groups in order (Apps, Data, Developers, Open Source, Legal), each with its pages in the order its `meta.ts` gives, every row with its icon and short label (a page's `sidebar.label`, or its title).
- `docs-images` shows at least one framed 1600 × 1000 image on every page but Legal, Raycast, Mac and iPhone and iPad, and on Features one in each main section; each opens larger when clicked. `scripts/docs-assets` makes them ([README](../../../../scripts/docs-assets/README.md)), and `bun test scripts/docs-assets` checks that every page has one and every alt text matches its shot.
- `docs-related` ends most pages with two **Related pages** cards (the page's `related` frontmatter).
- `docs-page` renders a page's title, description, body and "On this page" outline, in light and dark, without horizontal page scroll at 390px.
- `docs-agent-visibility` keeps `<Visibility for="agents">` text out of the web page and puts it in the page's `.md` mirror and `llms-full.txt`.
- `docs-header` shows Login and Register to a signed-out visitor and only "Open Teak" to one with the `teak_session_hint=1` cookie, on marketing pages, docs, changelog entries and the API reference alike. `bun run --cwd apps/docs build` fails when a built page ships the header without the script and CSS that do this (`scripts/check-header-visibility.ts`).
- `docs-links` resolves every internal link and anchor (`blume validate --strict`, `blume audit`).
- `docs-blog` lists posts at `/blog`, newest first, as cover cards with date, title and description, and links to its RSS feed at `/blog/rss.xml`. Each post (`content/blog/*.mdx`, `type: blog`, `mode: center`) opens with its cover, shows its date and author above the title (`components/BlogPostHeader.astro`, Blume's `PageHeader` slot), and ends with two **Related pages** cards. The site footers link to it; the header doesn't. `bun test scripts/docs-assets` checks that every post opens with its cover and every image matches its shot.

## How to get to it (user POV)

- Locally: `bun run dev docs` (or `bun run --cwd apps/docs dev`), then `http://localhost:3001/docs` (a worktree prints its own docs port in `bun run dev --status`).
- Production: `https://teakvault.com/docs`.
- A page's Markdown: its URL plus `.md`, such as `/docs/testing.md`.
- The built site, with `llms.txt` and `llms-full.txt`: `bun run --cwd apps/docs build:site`, then `bunx blume preview` in `apps/docs`.

## Driving it with e2e MCP and curl

Preconditions:

- The docs dev server answers `200` at `/docs` on its port. It needs no sign-in and no backend.

Steps:

- **Sidebar.** `open_session` on `http://localhost:3001/docs/architecture`. The sidebar shows, in order: "Welcome to Teak", "Features", "Support", then the group "Apps" (Mac, iPhone and iPad, Browser Extensions, Raycast, CLI), "Data" (Import, Export), "Developers" (API, API Quickstart, TypeScript SDK, MCP, WebMCP, AI Agents), "Open Source" (Development, Architecture, Testing, Adding a Feature, Translating, Self-Hosting) and "Legal", each row with an icon. The current page is highlighted and its breadcrumb names its group. The page headings keep the full titles ("Mac App", "Command Line").
- **Page.** Open each page a change touches. The heading matches its frontmatter `title`, the description shows under it, and "On this page" lists its H2 headings. Repeat in dark (`colorScheme: "dark"`) and at 390px, where `document.documentElement.scrollWidth` stays at most the window width; wide tables scroll inside their own box.
- **Images.** On `/docs/architecture`, the diagram shows under the first paragraph, inside `article.prose` as an `img` whose alt starts "Teak's apps talk to one Convex backend"; `tap` it and it opens larger. `bun test scripts/docs-assets` passes. Open `/docs/features`: the open card image has markers 1 to 3 and the numbered list under it names Tags, Summary and Colors.
- **Agent text.** On `/docs/testing`, the page has no "Notes for agents" section. `curl -s http://localhost:3001/docs/testing.md | grep "Notes for agents"` finds it. Do the same for any page whose `Visibility` block the change touches.
- **Header.** On `/docs/testing` and `/`, the header has links "Login" and "Register" and no visible "Open Teak". Add cookie `teak_session_hint` with value `1` for the host and reload: only "Open Teak" shows. Never all three.
- **Blog.** `open_session` on `http://localhost:3001/blog`. The heading reads "Blog", **Subscribe with RSS** links to `/blog/rss.xml`, and the grid lists every post in `content/blog` as a card with a cover image, a date like "October 27, 2026", a title and a description, newest first. Open the first card: the post shows its cover first, then the byline "<date> · Praveen Juge" above the title, no sidebar and no previous or next links, and **Related pages** at its foot. `curl -s http://localhost:3001/blog/rss.xml` lists the posts (from a build or preview). Repeat the index in dark and at 390px, where `document.documentElement.scrollWidth` stays at most the window width and the cards stack in one column. The footer on `/` and on a docs page has a **Blog** link.
- **Links.** `bun run --cwd apps/docs typecheck` (strict check and validate) and `bun run --cwd apps/docs build` (build and audit) both pass.

## Gotchas

- In a shallow clone (cloud sessions clone 50 commits), `blume validate --strict`, and with it the pre-commit hook, fails with `BLUME_SHALLOW_GIT_HISTORY` while a page is new or moved and has no git date. Run `git fetch --unshallow origin` once, then validate.
- Don't build while the docs dev server runs: the build refuses. Stop it first, or run `blume build --isolated`.
- The dev server doesn't serve `llms.txt` or `llms-full.txt`; read them from a build (`apps/docs/dist`) or a preview.
- Group folders in parentheses, such as `(open-source)`, add no URL segment: moving a page between groups keeps its URL. Renaming the file changes it, so add a redirect in `blume.config.ts`.
- `/api` and `/mcp` on the docs dev server proxy to the development deployment; the API, CLI and MCP recipe ([api-cli-mcp](./api-cli-mcp.md)) covers them.
