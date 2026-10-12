## Goal

Show data Teak already has: a **Refresh details** action on any card, the link author, publisher and date, and a photo's camera details. No schema change. Phase 1 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- None. Built on branch `claude/amazing-volta-697ngf`. This file records what shipped.

## Decisions made during the build

- **Name:** "Refresh details", not "Re-run AI". The owner chose it because AI is not a selling point for designers. The UI, API, MCP, SDK, CLI and docs use it: `POST /v1/cards/:id/refresh`, `teak_v1_refresh_card`, `cards.refresh`, `teak refresh`. Internal Convex names keep the codebase's "reprocess" term (`reprocessCard`, `reprocessCardForUser`, the `cardReprocess*` limits).
- **Limits:** the owner kept the existing limits. That is once per card per minute (`cardReprocessPerCard`) and six cards per minute per account (`cardReprocess`), shared with content edits that reprocess.
- **Refusals in the app are returned, not thrown.** The session mutation `cards.reprocessCard` returns `{ status: "refused", code, message, retryAt? }` for `RATE_LIMITED`, `CONFLICT` (in Trash) and `NOT_FOUND`. That keeps expected refusals out of the console and the Next dev overlay. The handler checks both limits with `rateLimiter.check` before it spends either token, so a committed refusal never uses up the card's minute.
- **Photos in the scenario pack go through the real upload path.** The CLI uploads them, and the Files Worker extracts their EXIF. The opt-in seeder covers only link bylines, because image cards need stored files.

## Success Criteria (met)

- **Refresh details:** it sits in the card modal and the grid context menu, for active cards only. It clears and regenerates the summary, tags Teak added, the transcript and the link preview. A second click within the minute shows "This card is already refreshing. Try again in a minute."
- **Link byline:** link cards show `hostname · By {author} · {publisher} · {date}` and drop missing or junk parts. The publisher is dropped when it only repeats the host or the author. Authors that are URLs are dropped, and dates that are unparsable, before 1990 or in the future are hidden.
- **More information:** the dialog lists Created, Updated and the file facts. Links get a **Source** section (Author, Publisher, Published). Photos get a **Photo** section (Camera, Taken, Exposure, Aperture, Focal length, ISO). GPS is never rendered.
- **API:** `POST /v1/cards/:id/refresh` returns these responses:
  - 202 `{ cardId, requestedAt, status: "queued" }`.
  - 429 `RATE_LIMITED` with `retryAt`, `Retry-After` and `RateLimit-*` headers.
  - 409 `CONFLICT` for a card in Trash, and 404 for an unknown card.
  - 401 without auth.

## What changed

**Backend (`packages/convex`)**
- `card/updateCard.ts`:
  - `reprocessCardForUserHandler` checks ownership (NOT_FOUND) and Trash (CONFLICT), checks then charges both limits, schedules `startCardProcessingWorkflow`, and returns `{ cardId, requestedAt }`.
  - It is exposed through the session `reprocessCard` mutation, which returns refusals, and the internal `reprocessCardForUser` mutation, which throws them for the HTTP mapping.
- `ai/actions.ts manuallyGenerateAI` delegates to the internal mutation. `consumeCardReprocessLimitForUser` was removed because nothing called it.
- **Public API:**
  - `parseCardRoute` gets a `refresh` operation, and `handleCardsByIdV1Request` gets a matching branch (it includes trashed cards so they get a 409).
  - The `executePublicApiOperation` regex now matches `restore|refresh`.
  - `publicApiMeta` lists the route, and `publicApiOpenApi` adds the `refreshCard` operation.
- **MCP, SDK and CLI:**
  - `mcp/tools.ts` adds `teak_v1_refresh_card` (WRITES).
  - `client/sdk.ts` adds `cards.refresh` and `RefreshCardResponse`.
- `devSeed.ts`: `seedScenario({ workosUserId, scenario: "card-details" })` adds 10 link cards. They cover a full byline, a distinct publisher, author only, date only, a URL author with a junk date, a 300-character byline, RTL and CJK text, a unicode host, a failed preview, and one trashed card. It is dev-only, uses marker URLs, and is idempotent.

**CLI (`apps/cli`)**
- `teak refresh <ids...>` and `teak cards refresh <ids...>` try every ID and report failures. A rate-limited ID exits with code 5, and `--json` returns `{ queuedIds, failed? }`.

**Web (`packages/ui`)**
- `hooks/useReprocessCard.ts` ignores repeat clicks while a request is in flight. It shows a success or refusal toast; for thrown errors it uses `lib/reprocessError.ts`.
- `CardMetadataPanel` shows a "Refresh details" panel button with a spinner while pending. `Card.tsx` adds a context-menu item, which is hidden in Trash.
- `lib/linkByline.ts` (`formatLinkByline`, `formatPublishedDate`) feeds `LinkPreview.tsx`. The hostname and byline truncate independently, and the byline has a `title`.
- `lib/exif.ts` (`formatExifFields`, `formatCamera`, `formatExposureTime`) feeds `MoreInformationModal.tsx`. The dialog was rewritten with sentence-case labels, `formatBytes` file sizes, a `dl` per section, and right-aligned truncating values.

**Docs:** `features.mdx` (Refresh details, Card details), `api.mdx`, `mcp.mdx`, `cli.mdx`, and `changelog/october-2026.mdx`.

## Tests

- `publicApiCardEditing.test.ts` (convex-test, "Refresh details" block):
  - The run is queued, and a second run within the minute is refused with `retryAt`.
  - The seventh card in a minute is refused, and another user's card is refused without spending the owner's limit.
  - The session mutation returns a refusal.
  - A refusal from the account-wide limit leaves the card's own token unspent. Removing the `check` calls makes this test fail.
  - A card in Trash is refused.
- `__tests__/publicApiHttpCards.test.ts`:
  - 202, 429 with `Retry-After`, 409 and 404.
  - `executePublicApiOperation` dispatch.
- Other Convex tests:
  - `__tests__/mcp.test.ts`: tool listed.
  - `__tests__/publicApiGateway.test.ts`: 19 operation IDs.
  - `__tests__/ai/actions.test.ts`: delegation.
  - `devSeed.test.ts`: the pack is refused on hosted WorkOS, and is idempotent.
- `packages/ui`:
  - `lib/__tests__/exif.test.ts`: table tests, and GPS never output.
  - `lib/__tests__/linkByline.test.ts`: dedupe, URL authors, long, RTL and CJK names, and junk or future dates.
  - `lib/__tests__/reprocessError.test.ts`.
  - `modals/__tests__/MoreInformationModal.test.tsx`: sections, no GPS.
  - `LinkPreview.test.tsx`: byline shown, absent, and ignored on a failed preview.
  - `Card.test.tsx`: the menu item is hidden in Trash.
- `apps/cli/src/commands.test.ts`: refresh succeeds, is rate-limited with exit 5, and returns `--json`.

## Break-it pass (done)

- **Bugs found and fixed:**
  - "Camera" was both the section title and the first row label; the section is now "Photo".
  - "Taken" did not use the same time format as Created and Updated.
  - A refused re-run was a thrown mutation error, which logged to the console and raised the Next dev overlay. It is now a returned refusal.
  - Returning a refusal could have spent the card's token on an account-wide refusal. The handler now checks both limits before charging (regression test above).
- **Checked:**
  - Rapid double-clicks: the second click is refused with a toast and nothing is queued twice.
  - A real refresh regenerated the summary and tags in about 8 seconds.
  - Trash hides the action.
  - API, CLI and MCP: bad input, unknown ID, wrong method, no auth, and Trash.
  - Long, RTL and CJK bylines, light and dark, 390px and 1440px.
  - No GPS appears in the dialog.

## Known limitations

- "Taken" is shown in the viewer's time zone. The Files Worker folds the EXIF offset into a UTC timestamp, so the camera's wall-clock time can't be recovered without storing the offset.
- The client still receives `fileMetadata.exif.latitude` and `longitude` in the card document; only rendering is guarded. Public share links (Phase 18) must project them out.

## Release gate

1. Run lint, typecheck, `packages/convex` `test:unit` and `test:edge`, `packages/ui`, `apps/web` and `apps/cli` tests.
2. Seed `card-details` and upload the three photos, then run the break-it pass (done).
3. Prepare the proof bundle: a video and screenshots in the session scratchpad, plus captured curl, CLI and MCP output in the PR.
4. Open the PR and get CI green, then merge. Deploy Convex and web; there is no Files Worker change and no backfill. Smoke-test production with Refresh details on one card and one `POST /v1/cards/:id/refresh`.
