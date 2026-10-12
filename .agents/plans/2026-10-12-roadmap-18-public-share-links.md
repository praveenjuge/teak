## Goal

Let people share a card, a folder or a smart folder through an unguessable, revocable public link (with optional expiry), viewable without an account as a read-only page, and let folder shares publish an RSS feed. Phase 18 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 5](2026-10-12-roadmap-05-folders.md) (folders) and [Phase 8](2026-10-12-roadmap-08-smart-folders.md) (smart folders evaluated live).

## Success Criteria

- "Share" on a card or a folder creates a link `/s/<token>`; the owner can copy, regenerate (old link dies), set or clear an expiry, and revoke it.
- An anonymous visitor sees a read-only page (masonry grid for folders, a single card view for a card) with "Made with Teak"; nothing private leaks: never notes, user ID, email, GPS, processing internals, archived or trashed cards.
- Revoked, expired and unknown tokens all return the same 404 page.
- A folder share has `/s/<token>/feed.xml`, valid RSS listing the folder's visible cards.
- Settings lists all active links with revoke; `/v1/shares`, MCP and CLI manage them.

## Context And Current Facts

- `apps/web/src/proxy.ts` requires a session for every page except `publicInfrastructureRoutes` (`/opengraph-image`) and `/callback`, and its matcher runs on all non-asset paths. `/s/` must be let through before `authkit()` runs.
- Security headers come from `apps/web/src/lib/security-headers.ts` (`buildContentSecurityPolicy`, `staticSecurityHeaders` with CSP and `Referrer-Policy`) applied in `apps/web/next.config.*` `headers()`; the share route needs its own stricter set (`no-referrer`, `no-store`, `noindex`).
- `http.ts` has no `/public/` routes; existing public API routes all require auth. The share endpoint is a new unauthenticated `httpAction` with its own rate limit in `shared/rateLimits.ts`.
- The public API card serializer (`publicApiHttpValidation.ts serializeCard`) includes `notes`, `aiTranscript`, `appUrl` and processing fields, so it must not be reused; shares need a separate allow-list projection.
- Signed file and thumbnail URLs come from `card/queryUtils.ts` (`attachFileUrls`, `attachGridFileUrls`).
- EXIF in `fileMetadata.exif` includes `latitude` and `longitude`; the projection drops `exif` entirely except formatted non-GPS fields if shown at all.
- Phase 14 stores article HTML; this phase does not expose it.

## Constraints And Non-goals

- `shareLinks` is a per-user table: add it to `accountDeletionData.ts ancillaryPage`; card hard delete and folder deletion revoke (delete) links pointing at them (`card/deleteCard.ts`, `workflows/cardCleanup.ts`, `workflows/folderDeletion.ts`).
- Tokens: 128-bit random, base64url; store only a hash and look up by hash.
- Smart folder shares evaluate the query live through the planner, with archived and trashed cards excluded.
- Anonymous endpoint is rate-limited per token and per IP; responses are `Cache-Control: no-store`.
- No comments, no collaboration, no indexing by search engines.
- Run `/security-review` before the PR.
- Public API order: `publicApiShares.ts` → `publicApiHttpShares.ts` → `executePublicApiOperation` → `http.ts` `/v1/shares` and `/v1/shares/` prefix with OPTIONS, plus `GET /public/shares/` prefix → `publicApiOpenApi.ts` (owner endpoints only) → `mcp/tools.ts` → `client/sdk.ts` → CLI.

## Backend

- `schema.ts shareLinks { userId, tokenHash, kind: "card" | "folder", cardId?, folderId?, expiresAt?, revokedAt?, createdAt, lastViewedAt? }` with `by_tokenHash`, `by_userId`, `by_cardId`, `by_folderId`.
- `shares/shares.ts`: `createShare` (returns the token once), `regenerateShare`, `setShareExpiry`, `revokeShare`, `listShares`.
- `shares/publicView.ts`: internal query resolving a token hash to an allow-listed projection: `title, content, url, preview image, aiSummary, tags, type, createdAt`, signed file and thumbnail URLs; paged for folders.
- `http.ts`: `GET /public/shares/:token` (JSON) and `GET /public/shares/:token/feed.xml` (RSS); identical 404 for unknown, revoked, expired, archived or trashed targets.

## Web

- `apps/web/src/app/s/[token]/page.tsx`: server-rendered, fetches the Convex endpoint, renders a read-only masonry grid or a single card view, "Made with Teak" footer; `export const metadata` with `robots: { index: false }`.
- `apps/web/src/proxy.ts`: bypass for `/s/` paths before `authkit()`; response headers `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, and a strict CSP for that route.
- Share dialog from the card modal and the folder menu: Copy link, Expiry (none, 1 day, 7 days, 30 days), Regenerate, Revoke.
- `packages/ui/src/components/settings/SharedLinksDialog.tsx`: all links with target, created, expiry, revoke.

## API / MCP / SDK / CLI

- `GET/POST /v1/shares`, `PATCH/DELETE /v1/shares/:id`, `POST /v1/shares/:id/regenerate`.
- MCP `teak_v1_list_shares`, `teak_v1_create_share`, `teak_v1_revoke_share`; SDK `shares.*`; CLI `teak share <cardId|--folder id> [--expires 7d]`, `teak shares ls | rm`.

## Docs

- `features.mdx`: new "Sharing" subsection with what visitors can and cannot see.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- `content/docs/(legal)/privacy-policy.mdx` if public pages change what is disclosed (confirm with the owner).
- Ship-month changelog: "Share cards and folders".

## UI states

- Empty: a shared empty folder shows "Nothing here yet." to visitors; Settings shows "No shared links."
- Loading: the public page is server-rendered (no client skeleton); the share dialog shows the link field disabled while creating.
- One item / many items: folder pages paginate with "Load more".
- Very long names: titles truncate in the grid; the card view wraps.
- Error: one generic "This link isn't available." page for every failure.
- Rate-limited: visitors see the same page with a 429 status; owners see "Too many links created. Try again soon."
- UI bar: the public page uses the same card visuals, no app chrome, light and dark by system preference; correct at 390px and 1440px.

## Scenario seed packs

- `shares`: active, expired, revoked and regenerated tokens for a card, a manual folder and a smart folder; a shared folder containing archived, trashed and GPS-tagged image cards; a smart folder matching nothing and everything.

## Break-it checklist

- UI: open a shared link signed out and signed in; regenerate while a visitor has the old page open; revoke then reload; expiry boundary; 390px public page; dark mode.
- Backend: revoked and expired tokens return 404; response contains no `notes`, `userId`, email, `latitude`, `longitude`, `processingStatus`; archived and trashed cards excluded; token brute-force rate limit; another user's share ID on owner endpoints; card hard delete and folder delete remove links; account deletion removes links; RSS validates.

## Tests

- `packages/convex/shares.test.ts` (convex-test, add to `vitest.config.ts`): revoked/expired 404; projection excludes notes and GPS; archived and trashed excluded; smart folder live; deletion cascades.
- `packages/convex/__tests__/shares/publicView.test.ts`: allow-list snapshot of the projection keys.
- `packages/convex/__tests__/publicApiHttpShares.test.ts` and `mcp.test.ts`.
- `apps/web/src/__tests__/proxy.test.ts` (or `authRoutes.test.ts`): `/s/` bypasses sign-in; other routes still redirect.
- `packages/tests/src/web/public-share.e2e.ts`: anonymous view of a shared folder and card; revoked link shows the unavailable page.

## Proof before the PR

- Video: share a folder, open it in a private window, add a card to the folder and reload, revoke, reload (unavailable); share a single card with a 1-day expiry.
- Screenshots: share dialog, public folder grid, public card view, unavailable page, Settings shared links; light and dark; 390px and 1440px.
- Captured `GET /public/shares/<token>` JSON (showing the allow-listed keys), `feed.xml`, `/v1/shares` calls, CLI output, and the `/security-review` summary.

## Release gate

1. Narrow tests above, then the repo checks and `public-share.e2e.ts`, `06-security.e2e.ts`, `03-api.e2e.ts`.
2. Seed `shares`, run the break-it pass and `/security-review`, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex then web. No backfill. Smoke-test production: share and revoke a test folder; confirm response headers on `/s/<token>`.

## Risks And Open Questions

- Signed file URLs in a public page can be copied; keep their TTL short and re-sign on each page view.
- Should a shared smart folder be allowed to expose cards later saved by the owner? Proposed yes (it is live by definition) with that stated in the share dialog.
