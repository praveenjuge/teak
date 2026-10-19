## Goal

Add a "Remove background" action for a link card's image and for image cards. Cloudflare Images cuts out the subject, and the cut-out becomes the card's displayed image, shown transparent on the card background. The original stays, and Undo and "Reset to original image" bring it back. Phase 15 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing in v3. The link thumbnail override (v2 phase 17) has shipped and is the base.

## Success Criteria

- **Where the action appears:**
  - In the card modal's ⋯ menu, "Remove background" sits under "Replace image" for a link card whose displayed image is a preview image or an override, never a screenshot.
  - Image cards get the same item, plus "Reset to original image" once they have a cut-out.
- **The cut-out:**
  - Running it makes a transparent cut-out of the image currently shown, stores it as the card's thumbnail override, and shows it on the tile and in the modal with no backdrop.
  - The toast reads "Background removed · Undo".
- **Undo and reset:** Undo restores the previous image within the existing undo window. "Reset to original image" removes the override, for link cards (as today) and for image cards.
- **The original file is never changed.** Image cards still download the original, and their palette, OCR and AI tags still come from it.
- **Refused images:** animated GIFs, SVGs, images over 20 MB, a screenshot-only link, and Trash all get a clear message.
- **Other surfaces:** API, MCP, SDK and CLI can remove the background and reset it.
- **Native apps:**
  - Link cards already show the override, so they show the cut-out.
  - Image cards keep showing the original in native apps until a later update. That is acceptable, and noted in `.agents/sunset.md`.

## Context And Current Facts

- **Cloudflare Images supports background removal.** The Images binding's `ImageTransform` type has `segment?: 'foreground'` (`apps/files-worker/worker-configuration.d.ts:13749`), next to `background`, `fit` and `trim`. The binding is `IMAGES: ImagesBinding` (`worker-configuration.d.ts:18`, `wrangler.jsonc:93`).
  - Confirm on dev that `segment` runs through the binding (not only URL transforms) and how it is billed, before building on it. The fallback is in Risks.
- `apps/files-worker/src/imagesBinding.ts`:
  - `IMAGES_BINDING_MAX_INPUT_BYTES = 20 MB` (4);
  - `throughImagesBinding` (6).
- `apps/files-worker/src/imageTransform.ts`:
  - Renditions tiny 48, compact 256, grid 512 and detail 1600 (30–35).
  - `transformViaBinding` (163) only outputs `image/avif` or `image/webp` (`bindingOutputFormat`, 150). Both keep alpha.
  - Other `Accept` values return `null` and fall back to another path (check that path for alpha; see Risks).
- **`packages/convex/card/thumbnailOverride.ts`** (515 lines):
  - Roles `thumbnail-override` and `thumbnail-override-pending` (43–44).
  - `assertReplaceable` (83–97) refuses non-link cards with `TYPE_MISMATCH` "Only link cards have an image to replace", and trashed cards with `CONFLICT`.
  - Rate limit `thumbnailReplace` (`consumeThumbnailChange`, 120) at 20 per minute.
  - `setThumbnailForUser` (309) finalizes through `finalize-image-upload`, then `applyThumbnailOverride` (263).
  - Reset is at 396–430 and undo at 432+.
  - Schema: `thumbnailOverrideValidator` `{ storageKey, width, height, updatedAt }` (`schema.ts:152-157`), `cards.thumbnailOverride`, and `previousThumbnailOverride` (477–480).
- **Display:**
  - `card/queryUtils.ts` reads `card.thumbnailOverride` (115–117, 308), signs the override as `linkPreviewImageUrl`, and sets `hasThumbnailOverride` (235–263).
  - Image cards use `imageRenditions` for `thumbnailUrl`, `compactUrl` and `detailUrl` (240–251), and `fileUrl` for the original.
  - `packages/ui/src/components/cards/linkCardImage.ts:31-88` picks the image for a link tile: override, then media, then preview image, then screenshot.
  - `FileCardBody.tsx:20-21` shows `thumbnailUrl ?? compactUrl ?? fileUrl` for image tiles.
- **Modal menu:** `packages/ui/src/components/card-modal/CardModal.tsx` 739–756 holds "Replace image" and "Reset to original image", driven by `imageControl` from `hooks/useLinkThumbnail.ts` (wired in `ConnectedCardModal.tsx`).
- **Public API:**
  - The routes are `thumbnail-set`, `thumbnail-reset` and `thumbnail-upload` (`publicApiHttpValidation.ts:717-765`).
  - Serializers expose `thumbnailOverridden` (160, 217).
  - The MCP tools are `teak_v1_create_thumbnail_upload`, `teak_v1_set_card_thumbnail` and `teak_v1_reset_card_thumbnail`. The CLI command is `cards thumbnail` (parity rows `scripts/public-parity.ts:170-186`).
- **Product detection:** the `product` category is in `shared/linkCategories.ts`. The owner chose a button for every eligible card, not automatic product cut-outs.

## Constraints And Non-goals

- **On request only.** Nothing is automatic, and there is no setting.
- **Eligible images:**
  - **Link cards:** the image the tile shows, in `resolveLinkCardImage`'s order (`packages/ui/src/components/cards/linkCardImage.ts`): the current override, else the first attached image in `metadata.linkPreview.media`, else the link preview image (`imageStorageKey`). Never the screenshot (`screenshot` role) or a video poster.
  - **Image cards:** the original file key, when the file is a still raster image (JPEG, PNG, WebP, AVIF or HEIC) of 20 MB or less. Animated GIFs, animated WebPs and SVG are refused; still WebP is allowed.
- **Output:** WebP with alpha, quality 90, longest edge capped at 2048 px, stored under the `thumbnail-override` role. `thumbnailOverrideValidator` gains `cutout: v.optional(v.literal(true))` so tiles know to use `object-contain`.
- **Display, "pure transparent":** no backdrop, no padding beyond the tile's normal inset. `object-contain`, centred. It must stay legible in light and dark: dark subjects on dark tiles are accepted, as chosen.
- **Rate limit:** the existing `thumbnailReplace` bucket (20 per minute), plus a new `backgroundRemoval` daily bucket of 100 per user (see Risks).
- **No change to AI metadata, palette or OCR.** They keep reading the original.
- **Analytics:** add `background_removed { cardType, surface }` and `background_removal_failed { reason }` first.

## Files Worker

- `packages/files-protocol`: `FILES_OPS` gains `"remove-image-background"`. Params: `{ sourceKey, destKey, userId }`. Result: `{ width, height, size } | { declined: "too_large" | "unsupported" | "empty" }`.
- `apps/files-worker/src/removeBackground.ts` (new):
  - Read `sourceKey` from R2 and check its ownership prefix against `userId`.
  - `throughImagesBinding(env.IMAGES, size, …)`, then `.transform({ segment: "foreground", fit: "scale-down", width: 2048, height: 2048 }).output({ format: "image/webp", quality: 90 })`.
  - Write the result to `destKey` with `Content-Type: image/webp`, and return its dimensions from `images.info` on the output.
  - Decline `empty` when the output is under 1 KB, as a heuristic for "no subject found". Measure it on dev.
- Dispatch it in `ops.ts`. Deploy before Convex.

## Backend

- `card/thumbnailOverride.ts`:
  - Split `assertReplaceable` into `assertReplaceable` (unchanged, link only, used by Replace image) and `assertCutoutable`, which allows `link` and `image`.
  - **`removeBackgroundForUser(ctx, { userId, cardId })`** (action handler):
    1. Load the card, `assertCutoutable`, and refuse while trashed.
    2. Pick the source key with the same order as `resolveLinkCardImage`: for a link, the override key, else the first `type: "image"` entry of `metadata.linkPreview.media`, else `imageStorageKey` (video posters and the screenshot are skipped; with none, `NO_IMAGE` "This link has no image to cut out"). For an image card, the file key (refuse animated GIF/WebP and SVG through the stored MIME type and animation metadata).
    3. Consume `thumbnailReplace` and `backgroundRemoval`.
    4. Build a fresh `thumbnail-override` key and `ensureObjectOwnership` for it **before** calling `remove-image-background`, as `setThumbnailForUser` does today. If the op declines or the apply step below fails, delete the written object (`deleteFinalizedObject`).
    5. Apply it through a new `applyCutoutOverride` internal mutation, not `applyThumbnailOverride`: that one queues `sourceKey` for deletion after writing (`thumbnailOverride.ts:283`), which is right for an uploaded replacement but would delete the original preview, media or file here. `applyCutoutOverride` calls the same `changeThumbnail` with `cutout: true` (so `previousThumbnailOverride` still covers undo) and never deletes the source; it uses `assertCutoutable` instead of `assertReplaceable`.
    6. Return `{ changeId, undoUntil }`.
  - Public `removeImageBackground` (action) and `removeImageBackgroundForUser` (internal action, for the API).
  - Reset and undo accept image cards too: clearing the override shows the original renditions again.
- `card/queryUtils.ts`: for `type === "image"` with `thumbnailOverride`, `thumbnailUrl`, `compactUrl`, `detailUrl` and `placeholderUrl` come from the override's renditions, `fileUrl` stays the original, and `hasThumbnailOverride` is set. Expose `thumbnailCutout: true` when `cutout` is set.
- `mobileCardSummaries.ts` stays as it is for image cards (they show the original). It already passes the link override through.
- Card hard delete and account deletion already cover `thumbnail-override` keys through `cardStorageObjectKeys`. Add a test for an image card with an override.

## Web

- `hooks/useLinkThumbnail.ts` becomes `useCardImageControl`, keeping `useLinkThumbnail` as a re-export. It adds `removeBackground()` and an `isRemovingBackground` state, and it is offered for image cards too (Replace image stays link-only).
- `CardModal.tsx` menu (around 739–756):
  - "Remove background" with the `Eraser` icon, placed after "Replace image" (or first for image cards).
  - It is disabled with a tooltip on ineligible images: "Can't remove the background of an animated image", "This link only has a screenshot".
  - While running, the item shows a `Spinner` and the label "Removing background…". The modal image area shows a 2 s shimmer over the current image (a skeleton, not a spinner).
- **Toasts:**
  - success: "Background removed · Undo"
  - failure: "Couldn't find a clear subject in this image." or "Couldn't remove the background. Try again."
  - rate-limited: the existing `THUMBNAIL_ERROR_MESSAGES.rateLimited`, plus "You've removed 100 backgrounds today. Try again tomorrow." for the daily cap.
- Tiles (`LinkCardBody.tsx` and `FileCardBody.tsx`) and the previews (`LinkPreview.tsx` and `ImagePreview.tsx`) use `object-contain` with no backdrop when `thumbnailCutout` is set. The tile keeps the cut-out's aspect ratio within the masonry's limits.
- "Reset to original image" shows for image cards with an override.
- No keyboard shortcut. The item is reachable through the menu with arrow keys.

## API / MCP / SDK / CLI

- `POST /v1/cards/{cardId}/thumbnail/remove-background` returns 200 `{ changeId, undoUntil, card }`.
  - Errors: 400 `NO_IMAGE` and `UNSUPPORTED_IMAGE`, 404, 409 for Trash, 413 `IMAGE_TOO_LARGE`, 429. Add the codes to `PUBLIC_API_ERROR_CODES` and the SDK's `ERROR_CODES`.
- `DELETE /v1/cards/{cardId}/thumbnail` (reset) now also accepts image cards.
- The serializers add `thumbnailCutout: boolean`.
- MCP: `teak_v1_remove_card_background { cardId }`.
- SDK: `cards.removeBackground(id)`.
- CLI: `teak cards thumbnail <id> --remove-background`, and `--reset` works for image cards.
- `scripts/public-parity.ts`: the new row.

## Docs

- `features.mdx` → "Replace a link's image" becomes "Change a card's image". It adds Remove background, eligible images, the daily limit, and Undo and Reset.
- The API, MCP and CLI docs, and the changelog: "Remove an image's background".

## UI states

- **Ineligible:** the item is disabled with the reason, never hidden, so people learn it exists.
- **Loading:** a shimmer over the image, and a spinner in the menu item.
- **Success:** a transparent cut-out on the light and dark tile.
- **Odd sources:** very wide or very tall cut-outs stay within `MAX_RENDITION_ASPECT` (8). Tiny subjects stay centred.
- **Error:** the toasts above. The card keeps its previous image.
- **Rate-limited:** a toast with the retry time.

## Scenario seed packs

- `background-removal`:
  - product links with a clean studio photo, a busy lifestyle photo, and a transparent PNG preview image;
  - a link with only a screenshot;
  - image cards: JPEG, PNG with alpha, HEIC, animated GIF, SVG, a 19.9 MB and a 21 MB image, a 1×1 px image, and an image with no clear subject (a texture);
  - a card at the end of its undo window.

## Break-it checklist

- **UI:**
  - double-click the item;
  - remove, then Undo after the window ends;
  - remove then Replace image then Reset;
  - two tabs removing at once;
  - offline mid-action;
  - light and dark tiles with a black-on-transparent subject;
  - keyboard only;
  - 390 px modal.
- **Backend:**
  - ineligible types, trashed cards, another user's card;
  - a source key from another user (the ownership check);
  - the 20 MB boundary;
  - Images binding errors and the `empty` output;
  - the daily cap;
  - account deletion with an image-card override.

## Tests

- `apps/files-worker/src/removeBackground.test.ts`: transform options, output format, declines and the ownership check, with the binding mocked.
- `packages/convex/thumbnailOverride.test.ts` (convex-test, extend or add):
  - choosing the source for links (override first) and image cards;
  - refusals;
  - undo and reset for image cards;
  - `cutout` set;
  - rate limits.
- `packages/convex/__tests__/card/queryUtils.test.ts`: image cards with an override use the override renditions and keep `fileUrl`.
- API, MCP, SDK and CLI tests for the new operation and its error codes.
- `packages/ui/src/components/card-modal/__tests__/CardModal.menu.test.tsx`: the item appears, its disabled reasons, and Reset for image cards.
- e2e: `packages/tests/src/web/background-removal.e2e.ts` runs on a seeded product link, with the worker mocked on the E2E stack if the Images binding isn't available locally (see Risks).

## Proof before the PR

- **Video 1:** a product link and a photo image card, each going through Remove background, Undo, Remove again and Reset.
- **Video 2:** the failures: animated GIF, screenshot-only link, "no clear subject", and the rate limit.
- **Screenshots:** the cut-out tiles in the grid in light and dark at 390 and 1440 px, the modal, and the disabled menu items.
- **Captured:** the `POST …/remove-background` request and response, and the CLI output.

## Release gate

1. Run the narrow tests, then the repo checks.
2. Seed `background-removal`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Deploy the Files Worker first, then Convex and the web app.
5. Smoke-test one product link in production, checking the tile in light and dark.

## Risks And Open Questions

- **Binding support and pricing.** `segment: "foreground"` is in the binding's types, but check on dev that it works through `env.IMAGES.input().transform()` and how it is billed. Fallback if it doesn't:
  - fetch a signed source URL through `cf.image` with `segment: "foreground"` (the URL-transform path in `fetchPrivateImageSource`);
  - otherwise a Workers AI segmentation model, if one is listed. Pick before building.
- **Non-avif/webp clients.** Some clients send an `Accept` header without avif or webp. Check the fallback rendition path, and make sure cut-outs are never flattened to JPEG with a black background (serve WebP, or a PNG rendition).
- **Native image cards** show the original until they read the override. Log it in `.agents/sunset.md`, or plan a small native follow-up.
- **"No clear subject" detection** is a size heuristic. Open decision: also compare alpha coverage using `images.info` (default: the size heuristic only, tuned on the seed pack).
- **Open decision:** the daily cap of 100 per user (default: 100).
- **Open decision:** whether palette and visual styles should use the cut-out for image cards (default: no, the original stays the source of truth).
