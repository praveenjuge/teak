# Docs site

teakvault.com's docs, built from `apps/docs/content` with Blume. Every page has a Markdown mirror at its URL plus `.md`, and `llms.txt` and `llms-full.txt` list the site for agents.

## Sub-features

- `docs-sidebar` lists the top-level pages, then the groups, each with its pages in its `meta.ts` order and every row with an icon and short label (a page's `sidebar.label`, or its title).
- `docs-images` shows a framed 1600 × 1000 image on every page but Legal, Raycast, Mac and iPhone and iPad, and one per main section of Features; each opens larger on click. `scripts/docs-assets` makes them ([README](../../../../scripts/docs-assets/README.md)); `bun test scripts/docs-assets` checks every page has one and each alt text matches its shot.
- `docs-related` ends most pages with two **Related pages** cards (`related` frontmatter).
- `docs-page` renders a page's title, description, body and "On this page" outline, in light and dark, at 390px without horizontal scroll.
- `docs-agent-visibility` puts `<Visibility for="agents">` text in the page's `.md` mirror and `llms-full.txt` only.
- `docs-header` shows Login and Register signed out and only "Open Teak" with the `teak_session_hint=1` cookie, on marketing pages, docs, changelog and the API reference. `bun run --cwd apps/docs build` fails when a built page ships the header without that script and CSS (`apps/docs/scripts/check-header-visibility.ts`).
- `docs-links` resolves every internal link and anchor (`blume validate --strict`, `blume audit`).
- `docs-blog` lists posts at `/blog` as cover cards with an RSS feed at `/blog/rss.xml`. Each post (`content/blog/*.mdx`, `type: blog`, `mode: center`) puts its byline above the title (`components/BlogPostHeader.astro`, Blume's `PageHeader` slot). Footers link to it; the header doesn't. `bun test scripts/docs-assets` checks every post opens with its cover and each image matches its shot.

## How to get to it (user POV)

- Locally: `bun run dev docs` (or `bun run --cwd apps/docs dev`), then `<docsOrigin>/docs`, where `<docsOrigin>` is `http://localhost:<docs>` with the `docs` port from `bun run dev --status`.
- Production: `https://teakvault.com/docs`. Every push to `main`, Workers Builds runs `bun run build` and `bun run deploy` (`cf deploy dist`, per `apps/docs/cloudflare.config.ts`) in `apps/docs`, to the assets-only `teak-site` Worker on the teakvault.com and www.teakvault.com Custom Domains; a zone redirect rule sends www to the apex.
- A page's Markdown: such as `/docs/testing.md`.
- The built site: `bun run --cwd apps/docs build:site`, then `bunx blume preview` in `apps/docs`.

## Driving it with e2e MCP and curl

Preconditions:

- The docs dev server answers `200` at `/docs` (no sign-in or backend needed).

Steps:

- **Sidebar.** `open_session` on `<docsOrigin>/docs/architecture`. The sidebar reads "Welcome to Teak", "Features", "Support", then "Apps" (Mac, iPhone and iPad, Browser Extensions, Raycast, CLI), "Data" (Import, Export), "Developers" (API, API Quickstart, TypeScript SDK, MCP, WebMCP, AI Agents), "Open Source" (Development, Architecture, Testing, Adding a Feature, Translating, Self-Hosting) and "Legal", each row with an icon. The current page is highlighted, its breadcrumb names its group, and page headings keep full titles ("Mac App", "Command Line").
- **Page.** On each page a change touches, the heading matches frontmatter `title`, the description shows under it, and "On this page" lists its H2s. In dark (`colorScheme: "dark"`) and at 390px, `document.documentElement.scrollWidth` stays at most the window width; wide tables scroll in their own box.
- **Images.** On `/docs/architecture`, the diagram under the first paragraph is an `img` in `article.prose` whose alt starts "Teak's apps talk to one Convex backend"; `tap` opens it larger. On `/docs/features`, the open card image has markers 1 to 3, and the list under it names Tags, Summary and Colors.
- **Agent text.** `/docs/testing` has no "Notes for agents" section; `curl -s <docsOrigin>/docs/testing.md | grep "Notes for agents"` finds it. Repeat for any `Visibility` block the change touches.
- **Header.** On `/docs/testing` and `/`, the header has links "Login" and "Register" and no visible "Open Teak". With cookie `teak_session_hint=1` for the host, after a reload only "Open Teak" shows. Never all three.
- **Blog.** `open_session` on `<docsOrigin>/blog`. Heading "Blog", **Subscribe with RSS** links to `/blog/rss.xml`, and every post in `content/blog` is a card with cover, a date like "October 27, 2026", title and description, newest first. The first post opens with its cover, then the byline "<date> · Praveen Juge" above the title, no sidebar or previous/next links, and two **Related pages** cards at its foot. `curl -s <docsOrigin>/blog/rss.xml` (from a build or preview) lists the posts. In dark and at 390px the index doesn't scroll sideways and the cards stack in one column. The footers on `/` and a docs page link **Blog**.
- **Hosting.** After a deploy, `curl -sI https://teakvault.com/docs/api` is `200` with `strict-transport-security`, `x-frame-options: DENY` and `access-control-allow-origin: *` once each; `curl -sI https://teakvault.com/docs/api/` is a `307` to `/docs/api`; `curl -sI https://www.teakvault.com/pricing` is a `308` to `https://teakvault.com/pricing`; `curl -sI https://teakvault.com/docs/skills` is a `301` to `/docs/ai-agents`; an old reference address like `/reference/operations/deletecard` is a `301` to `/reference/operations/delete-card` (`apps/docs/lib/referenceRedirects.ts`). `bun run build` writes `dist/_headers` (`apps/docs/scripts/security-headers.ts`) and `dist/_redirects`. `curl -s https://teakvault.com/robots.txt` is the checked-in `apps/docs/public/robots.txt`, with `Disallow` for `/api/v1/`, `/mcp`, `/v1` and `/*public/fonts/` (the daily `e2e:docs` probe checks them).
- **Links.** `bun run --cwd apps/docs typecheck` (validate) and `bun run --cwd apps/docs build` (audit) pass.

## Gotchas

- In a shallow clone (cloud sessions), `blume validate --strict`, and so the pre-commit hook, fails with `BLUME_SHALLOW_GIT_HISTORY` for a new or moved page without a git date. Run `git fetch --unshallow origin` once.
- The build refuses while the dev server runs: stop it, or `blume build --isolated`.
- The dev server doesn't serve `llms.txt` or `llms-full.txt`; use a build (`apps/docs/dist`) or preview.
- Group folders like `(open-source)` add no URL segment, so moving a page between groups keeps its URL; renaming the file changes it, so add a redirect in `blume.config.ts`.
- The site is static: `Accept: text/markdown` on a page URL returns HTML; use the `.md` URL.
- `/api` and `/mcp` on the docs dev server proxy to the development deployment ([api-cli-mcp](./api-cli-mcp.md)).
