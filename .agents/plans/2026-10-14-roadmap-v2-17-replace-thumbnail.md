## Goal

Let people replace any link card's image by dropping, pasting or choosing a file, and reset it to the original, on the web and through the API, MCP, SDK and CLI. Phase 17 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing in v2.

## Success Criteria

- In a link card's details, people can replace the image three ways: drop an image on the preview, paste one (⌘V / Ctrl+V while the card is open and no text field has focus), or choose "Replace image". The new image shows in the web grid and modal, and in the native grids and native views that use `linkPreviewImageUrl`, without an app update. Native detail views that prefer attached media follow in phases 29 (Apple) and 31 (Android).
- "Reset to original image" brings back the scraped image (or the screenshot fallback) and deletes the uploaded file.
- The replacement survives Refresh details, the screenshot workflow and new link media.
- API calls:
  - `POST /v1/cards/:id/thumbnail/upload` returns a signed upload URL.
  - `PUT /v1/cards/:id/thumbnail {fileKey}` applies the upload.
  - `DELETE /v1/cards/:id/thumbnail` resets it.
- MCP, SDK and CLI follow.
- Card hard delete and account deletion remove the uploaded object.

## Context And Current Facts

- **Grid image order.** In `packages/ui/src/components/cards/Card.tsx:~290` a link tile uses, in order:
  1. the first attached `linkPreviewMedia` image
  2. a video poster
  3. `linkPreviewImageUrl`
  4. the screenshot

  The modal (`card-previews/LinkPreview.tsx:138`) uses the OG image (`linkPreviewImageUrl`), then the screenshot.
- `linkPreviewImageUrl` is resolved on the server from `metadata.linkPreview.imageStorageKey` (`card/queryUtils.ts:248,369`).
- `card/mobileCardSummaries.ts:57` passes `linkPreviewImageUrl` to the native apps and takes the aspect ratio from `linkPreview.imageWidth/imageHeight`.
- Refresh details: `linkMetadata.ts updateCardMetadata` replaces `metadata.linkPreview` and deletes the old storage keys it does not carry over. An image stored inside `linkPreview` would be lost, so the replacement must live outside it, the way `metadataTitleEdited` survives.
- **R2 keys.**
  - `storage/r2.ts buildR2ObjectKey({ userId, cardId, role })` builds `…/users/<hash>/cards/<cardId>/<role>/<uuid>-<name>`.
  - The roles in use include `file`, `link-preview-image`, `link-media-<type>` and `link-media-poster`.
  - `cardStorageObjectKeys` lists every key deleted with a card. `card/deleteCard.ts`, `workflows/cardCleanup.ts`, `accountDeletion.ts`, `accountDeletionBatch.ts` and `workflows/orphanSweep.ts` all use it.
- **Upload path.**
  - `storage/r2.ts generateUploadUrl` (a session mutation, which takes `cardId` and `role`) returns a signed Files Worker upload URL.
  - The `finalize-image-upload` op (`apps/files-worker/src/finalizeImage.ts`) decodes the bytes and moves them from the source key to a destination key in the same user namespace. It returns trusted dimensions and format and rejects dimensions over 10,000. `card/uploadCardAction.ts:181` uses it.
- **API.**
  - `POST /v1/uploads` (`publicApiUploads.ts:66`) calls `ensureCardQuotaAvailable`. A free account at 200 cards could not upload a thumbnail through it, so the thumbnail needs its own upload URL.
  - `http.ts:193-215` routes GET, PATCH, POST and DELETE on `/v1/cards/`, but not PUT.
  - CORS `Access-Control-Allow-Methods` is `"GET, POST, PATCH, DELETE, OPTIONS"` (`publicApiMeta.ts:45`).
- HEIC is a known image format (`shared/fileFormats.ts:482`). Whether `finalize-image-upload` decodes HEIC through the Images binding is unproven.

## Constraints And Non-goals

- The new card field is top-level and optional, so old clients ignore it.
- The server resolves `linkPreviewImageUrl` from the replacement when one exists, so native grids and native views that use `linkPreviewImageUrl` show it with no update. Apple's detail view (`CardSheet.linkImageURL`) prefers attached media first; native detail-view precedence is handled in phases 29 (Apple) and 31 (Android). The web's grid order changes so a replacement beats attached media.
- The new R2 role is `thumbnail-override`. Replacing or resetting does not delete the old object at once. The whole previous override is kept, not just its key: `cards.previousThumbnailOverride { override: { storageKey, width, height, updatedAt } | null, changeId, deleteAfter }`. A live `thumbnailOverride` needs its trusted width and height (native layout uses them for the aspect ratio), so undo restores the complete object. A `null` override means the card was showing its original image. A new `changeId` is minted on every replace or reset, stored on the card as `thumbnailChangeId` and returned to the client, and `deleteObject` (the durable cleanup workflow) is scheduled with `ctx.scheduler.runAfter(THUMBNAIL_UNDO_WINDOW_MS = 2 minutes)`. This keeps an undo from pointing at a deleted object.
- Accepted types are JPEG, PNG, WebP, GIF (first frame on the grid), AVIF and HEIC if the worker decodes it. The limit is 20 MB, the Images binding input cap in `finalizeImage.ts`. SVG is refused.
- Rate limit `thumbnailReplace` (20 a minute per user) in `shared/rateLimits.ts`.
- Analytics: `card_thumbnail_replaced { source: "drop" | "paste" | "pick" | "api" }` and `card_thumbnail_reset`.

## Backend

- `schema.ts`, with one shared `thumbnailOverrideValidator = v.object({ storageKey: r2KeyValidator, width: v.number(), height: v.number(), updatedAt: v.number() })`:
  - `cards.thumbnailOverride: v.optional(thumbnailOverrideValidator)`
  - `cards.previousThumbnailOverride: v.optional(v.object({ override: v.union(thumbnailOverrideValidator, v.null()), changeId: v.string(), deleteAfter: v.number() }))`
  - `cards.thumbnailChangeId: v.optional(v.string())`
- `card/thumbnailOverride.ts`:
  - `createThumbnailUploadUrl({ cardId })`: owner, link type and not trashed. It checks no card quota. The pending key goes in the swept pending namespace, not under the card: `buildR2ObjectKey({ cardId: PENDING_UPLOAD_CARD_ID, role: "thumbnail-override-pending", fileName: "card-" + cardId })`. A replacement abandoned after upload (reload, offline, closed tab, or a failed `setLinkThumbnail`) is then deleted after 24 hours by the Files Worker's R2 events consumer (`apps/files-worker/src/queues/r2Events.ts`, backstopped weekly by the `cleanup-stale-pending-uploads` op), which only looks under `/cards/upload-pending-v2/`.
  - `setLinkThumbnail({ cardId, fileKey })` (action):
    - It checks that `fileKey` is in the caller's namespace, sits under `upload-pending-v2/thumbnail-override-pending/`, and ends in `-card-<cardId>`, so a pending key for another card is refused.
    - It runs `finalize-image-upload` to `buildR2ObjectKey({ role: "thumbnail-override" })`.
    - An internal mutation then patches the card (`patchCardWithSearchSync`), moves the previous replacement into `previousThumbnailOverride`, and schedules its deletion after the undo window.
    - If that mutation fails (or skips the patch), the action deletes the finalized key with the Files Worker `delete-object` op in its catch block, as `finalizeForUser` in `card/uploadCardAction.ts` does, then rethrows. The finalized object sits outside the pending namespace, so the 24-hour sweep would never remove it.
    - `undoThumbnailChange({ cardId, changeId })` works only when `changeId` equals the card's current `thumbnailChangeId` and `deleteAfter` is in the future. Otherwise it returns `UNDO_EXPIRED`. That covers an expired window and a stale toast from an earlier replace (A→B→C: the A→B toast can no longer restore B). When it works, it restores `previousThumbnailOverride.override` as the card's `thumbnailOverride`, including width and height. A `null` override resets the card to its original image, so undoing a first replace works. It also cancels that key's scheduled deletion and schedules the newer key's deletion instead.
    - The scheduled deletion checks that the key is not the card's current override before deleting, so a late undo or a double replace never removes a live image.
  - `resetLinkThumbnail({ cardId })`. Each of these has a `…ForUser` internal twin for the API.
- `storage/r2.ts cardStorageObjectKeys`: add `card.thumbnailOverride?.storageKey` and `card.previousThumbnailOverride?.override?.storageKey`, so an object kept for the undo window is deleted with the card.
- `card/queryUtils.ts` (`attachListUrls`, grid URLs) and `mobileCardSummaries.ts`:
  - With a replacement, `linkPreviewImageUrl` comes from its key, and the aspect ratio comes from its width and height.
  - They expose `hasThumbnailOverride: true`.
- `linkMetadata.ts updateCardMetadata`: leave the field alone. A test proves that Refresh details keeps it.

## Web

- `card-previews/LinkPreview.tsx`:
  - The preview image is a drop target with a dashed outline on drag-over.
  - While uploading, it shows the local object URL with a skeleton shimmer.
  - With no image, it shows a quiet "Add an image" drop area.
- `card-modal/CardMetadataPanel.tsx`: for link cards, "Replace image" (`ImageUp`), and "Reset to original image" when a replacement exists. The update is optimistic, with an undo toast that lasts as long as the server's 2-minute undo window. It calls `undoThumbnailChange` with the `changeId` its own replace returned.
- Paste: a `paste` listener in `CardModal.tsx`. It does nothing when the focus is in an input, a textarea or the editor.
- `cards/Card.tsx`: when `hasThumbnailOverride`, use `linkPreviewImageUrl` before attached media.

## API / MCP / SDK / CLI

- `parseCardRoute` gains `thumbnail-upload` (POST), `thumbnail-set` (PUT) and `thumbnail-reset` (DELETE).
- `http.ts`: add the PUT method on the `/v1/cards/` prefix. `publicApiMeta.ts`: add PUT to CORS.
- Errors: 400 for a non-link card or a bad image, 404 for another user's card or key, 409 for a trashed card, 413 for an image over 20 MB, 429 when rate-limited.
- `serializeCard`: `thumbnailOverridden: boolean`. `publicApiOpenApi.ts`: the three operations.
- MCP: `teak_v1_create_thumbnail_upload`, `teak_v1_set_card_thumbnail { cardId, fileKey }`, `teak_v1_reset_card_thumbnail`.
- SDK: `cards.setThumbnail(id, bytes, mimeType)` (upload URL, then `putFile`, then PUT) and `cards.resetThumbnail(id)`.
- CLI: `teak cards thumbnail <id> <file>` and `teak cards thumbnail <id> --reset`.

## Docs

- `features.mdx` Card details: "Replace a link's image".
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- The ship month's changelog: "Choose your own image for any link".

## UI states

- Empty: a link with no image shows "Add an image". It is drop-only and keyboard reachable through the panel button.
- Loading: the local preview with a shimmer, and the panel button disabled.
- One item / many items: in the grid, replaced tiles look like any other tile.
- Very long names: file names are never shown. The error toast names the problem, not the file.
- Error: "This image couldn't be read." (decode failure), "Images must be under 20 MB.", "Use a JPEG, PNG, WebP, GIF or AVIF image."
- Rate-limited: "You've changed a lot of images. Try again in a minute."

## Scenario seed packs

- `thumbnails`:
  - link cards with an OG image, with four attached X images, with a video poster only, with a screenshot only, and with no image
  - one card that already has a replacement
  - files: a 50 MB JPEG, HEIC, a transparent PNG, an animated GIF, a 10,000×10,000 PNG, a 10,001-pixel-wide PNG, an SVG, and a `.txt` renamed to `.png`

## Break-it checklist

- UI:
  - drop two files at once (take the first)
  - replace twice quickly
  - reset during an upload
  - paste while typing a note (ignored)
  - reload mid-upload, and reload after the bytes are uploaded but before `setLinkThumbnail` (the pending object is left in `upload-pending-v2` and the sweep deletes it after 24 hours)
  - two tabs replacing the same card
  - offline mid-upload
  - keyboard only
  - 390px
- Backend:
  - another user's `fileKey`
  - a key from another role or card
  - a non-link card and a trashed card
  - Refresh details after a replacement
  - hard delete and account deletion remove the replacement and the previous override kept for undo (R2 mock)
  - the card mutation in `setLinkThumbnail` fails after finalize: the finalized object is deleted
  - reset with no replacement (idempotent 200)
  - CORS preflight for PUT
  - an account at the free cap can still replace an image

## Tests

- `packages/convex/__tests__/card/thumbnailOverride.test.ts`: ownership, types, link only, the previous key survives until the undo window closes and is deleted after it, undo restores the previous override with its own width and height (a portrait A replaced by a landscape B comes back portrait) and cancels its deletion, undo of a first replace resets to the original image, a stale toast after A→B→C returns `UNDO_EXPIRED` and leaves C in place, undo after the window returns `UNDO_EXPIRED`, a double replace inside the window deletes only the right objects, reset, rate limit, the pending key lands under `upload-pending-v2` and a pending key for another card is refused, and a failed card mutation deletes the finalized key (Files Worker mocked).
- `packages/convex/__tests__/storage/r2.test.ts`: `cardStorageObjectKeys` includes the replacement key and the previous override key.
- `packages/convex/__tests__/card/queryUtils.test.ts` and `mobileCardSummaries.test.ts`: URL and aspect-ratio precedence.
- `packages/convex/__tests__/linkMetadata.test.ts`: `updateCardMetadata` keeps `thumbnailOverride`.
- `packages/convex/accountDeletionStorage.test.ts` (convex-test): the replacement key and the previous override key are deleted.
- `__tests__/publicApiHttpCards.test.ts`, `__tests__/publicApiGateway.test.ts` (PUT in CORS), `__tests__/mcp.test.ts`, `__tests__/sdk.test.ts`, `apps/cli/src/commands.test.ts`.
- UI: `cards/__tests__/Card.test.tsx` (a replacement beats attached media), `card-previews/__tests__/LinkPreview.test.tsx` (the empty "Add an image" state).
- e2e: `packages/tests/src/web/replace-thumbnail.e2e.ts` (new): pick a file, reload, reset. Plus `journey/03-api.e2e.ts` and `04-cli.e2e.ts`.

## Proof before the PR

- Video 1: drop an image on an article card, see it in the grid, Refresh details, and it stays. Then reset.
- Video 2: paste an image from the clipboard on an X post with four images, then try a 50 MB file and a `.txt`.
- Screenshots of the drop target, uploading, a replaced tile, the empty "Add an image", and each error toast. Each in light and dark, at 390px and 1440px.
- Captured upload, PUT and DELETE requests and responses, MCP output, and `teak cards thumbnail` output.

## Release gate

1. Run the narrow tests above, then the repo checks and the e2e specs listed.
2. Seed `thumbnails`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge and deploy Convex, then web. There is no Files Worker change unless HEIC needs one; if it does, deploy the worker first and update `scripts/check-files-readiness.ts`. No backfill.
5. Smoke-test production: replace and reset one card, and check it in the iPhone app.

## Risks And Open Questions

- **API shape.** `POST /v1/uploads` checks the card quota, so the plan adds a thumbnail-specific upload URL instead of reusing it. That means a third route, besides the PUT and DELETE in the approved plan.
- **HEIC.** Decoding through `finalize-image-upload` is unproven. If it fails, refuse HEIC in this phase.
- **Native detail views.** Apple's detail view prefers attached media over `linkPreviewImageUrl` (`CardSheet.linkImageURL`). The native grids follow the replacement, but the Apple and Android detail views get the same precedence in phases 29 and 31.
