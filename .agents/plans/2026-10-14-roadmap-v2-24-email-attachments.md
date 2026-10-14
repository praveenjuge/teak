## Goal

Turn every attachment on a saved email into its own file card, stored in R2 through the existing upload path, with the same formats and 100 MB limit as any upload, and tagged `email`. Phase 24 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 23](2026-10-14-roadmap-v2-23-email-in.md) (Email Worker, `/inbound/email`, receipts, `email` tag).

## Success Criteria

- An email with N supported attachments creates N file cards (image, video, audio or document by format), plus the body card from phase 23 when the body has content. An email with only attachments creates only file cards.
- Each attachment card has the tag `email`, `metadata.source: "email"`, its original file name, and the normal file processing (thumbnails, AI, OCR when phase 10 shipped).
- Unsupported formats, files over `MAX_FILE_SIZE`, signature logos, and `smime.p7s` / `winmail.dat` parts are skipped silently.
- At the free 200-card limit, the remaining attachments are dropped silently and their uploaded objects are removed.
- A retried email never duplicates an attachment card.

## Context And Current Facts

- The upload path is two steps:
  - `generateUploadUrlForUser` (`publicApiUploads.ts`) validates `validateUploadFile` and checks `ensureCardQuotaAvailable`. It builds a pending key with `buildR2ObjectKey({ cardId: PENDING_UPLOAD_CARD_ID, role: "file" })`, records ownership (`ensureObjectOwnership`) and returns a Files Worker signed PUT URL (`buildSignedWorkerUploadUrl`, 10-minute TTL).
  - `finalizeUploadedCardForUser` calls `createUploadedCardForUser` (`card/uploadCard.ts`), which charges the `cardCreation` token.
- Convex holds no S3 credentials. Every object write goes through the Files Worker (`files.teakvault.com`) with an HMAC-signed URL (`apps/files-worker/README.md`).
- `MAX_FILE_SIZE` = 100 MiB and `FILE_FORMATS` / `validateUploadFile` live in `shared/fileFormats.ts`. Markdown files are capped at `MARKDOWN_CONTENT_MAX_BYTES`.
- Orphaned pending objects are swept by `storage/pendingUploadCleanup.ts` (`sweepStalePendingUploads`).
- The `cardCreation` bucket is 30 per minute (`shared/rateLimits.ts`), so an email with 30 attachments plus a body exceeds one minute's tokens. `RATE_LIMITED` carries `retryAt`.
- Cloudflare Email Routing caps a message at 25 MiB including base64. That means real attachments never reach the 100 MB limit, and the Convex HTTP action body limit (20 MB) rules out sending attachment bytes through Convex.
- The phase 23 worker payload parser ignores unknown fields, so this worker can deploy before Convex.

## Constraints And Non-goals

- Attachment bytes go from the Email Worker straight to the Files Worker's signed PUT. Convex only mints URLs and finalizes.
- No new storage keys or roles. Cards reference the normal `fileKey`, so `cardStorageObjectKeys`, card hard delete and account deletion already cover them.
- No links from the body card to the attachment cards (phase 26 links are typed by people).
- Inline parts referenced by `cid:` from the HTML body that are images under 16 KB are treated as decoration and skipped. Larger inline images, such as iPhone Mail photos, are kept.
- No new public API, MCP or CLI surface. Attachment cards are ordinary cards.

## Email Worker

- `src/attachments.ts` (pure): `selectAttachments(parsed)` keeps parts with a file name or a known MIME type. It skips the decoration rule above and `application/pkcs7-signature`, `application/ms-tnef` and `text/calendar`, and caps the selection at 50 parts.
- The payload gains `attachments: [{ index, fileName, mimeType, size }]`.
- The Convex `200` response gains `uploads: [{ index, uploadUrl, fileKey }]`. The worker PUTs each part's bytes to `uploadUrl` with its `Content-Type`, two at a time.
- After each PUT, the worker POSTs a signed `POST /inbound/email/attachments` with `{ v: 1, receiptKey, index, fileKey, storedSize }`.
- With an old Convex deployment, which returns no `uploads`, the worker skips attachments.
- A failed PUT is retried twice. After that, the attachment is dropped and the pending sweep removes the object.

## Backend

- `inbound/http.ts` `ingestEmail` runs on each attachment:
  - It runs `validateUploadFile` and skips failures.
  - It mints the signed upload URLs with the same steps as `generateUploadUrlForUser`, extracted to a shared helper `mintPendingUpload(ctx, userId, { fileName, fileSize, mimeType })`.
  - It stops minting at the quota.
  - It records `pendingAttachments: [{ index, fileKey }]` on the receipt.
- `inboundEmailReceipts` gains `pendingAttachments?: [{ index, fileKey, state: "unclaimed" | "pending" | "done", claimedAt?, claimToken?, cardId? }]`. The per-index `cardId` replaces a separate list of card ids.
- New `httpAction` `inboundEmailAttachment` (same signature check) runs the internal **action** `finalizeEmailAttachment`. It must not call `createUploadedCardForUser` directly. That would leave `fileKey` under `cards/upload-pending-v2`, which `cleanup-stale-pending-uploads` deletes after 24 hours even when a card points at it. The action:
  - claims the index with an internal mutation (`claimEmailAttachment`). That mutation checks that the receipt and index exist and that `fileKey` matches the pending one. It then sets the index to `pending { claimedAt }` in the same transaction, so two overlapping finalizes (a worker retry after a timeout, or a duplicate delivery) can't both pass.
    - A `done` index returns its card id.
    - A fresh `pending` index (under 2 minutes old) returns `202 IN_PROGRESS`.
    - A stale `pending` index, or the scheduled `RATE_LIMITED` retry (which carries its own claim token), reclaims it.
    - A failure before the card exists clears the claim back to unclaimed.
  - calls the existing promotion path, `finalizeForUser` in `card/uploadCardAction.ts`. That path builds the permanent `stored` destination key and runs the Files Worker `finalize-upload` / `finalize-image-upload` op, then creates the card. `finalizeForUser` gains optional `tags`, `additionalMetadata` and `source: "email"` arguments for this.
  - Creating the card and completing the receipt happen in one transaction. `finalizeForUser` also takes an optional `receiptClaim { receiptId, index, claimToken }`, which it passes into the card-creating mutation (`createUploadedCardForUser`). That mutation re-checks the claim, returns the existing `cardId` if the index is already `done`, and otherwise creates the card and marks the index `done` with that `cardId` before committing. An interruption at any point therefore leaves either no card and a claim that can be retried, or a card and a `done` index, never a card without a record.
  - The promotion is idempotent too. The destination key is derived from `(receiptId, index)` instead of being random. If the pending source is already gone and the destination exists with the expected size and etag, `finalize-upload` treats it as already promoted. A retry after an interruption between promotion and card creation then finishes the card rather than failing.
- On `RATE_LIMITED`, the action schedules itself at `retryAt` (`ctx.scheduler.runAt`) and returns `202`. The object stays pending, inside the 24-hour sweep window. On `CARD_LIMIT_REACHED`, it deletes the pending object and records `email_received` with `outcome: "dropped_limit"`.
- `http.ts` adds `POST /inbound/email/attachments`.
- Analytics: `email_attachment_saved { kind, size_bucket }` and `email_attachment_skipped { reason: "format" | "size" | "decoration" | "limit" | "upload_failed" }`.

## Web

- No new UI. Attachment cards render as any file card. The `features.mdx` copy and the Settings dialog how-to line mention attachments.

## Docs

- `features.mdx` "Save by email": "Attachments become their own cards (same formats and 100 MB limit as uploads)."
- The ship month's changelog: "Email attachments are saved as cards".

## UI states

- Empty: an email with no attachments behaves as in phase 23.
- Loading: attachment cards appear with the normal processing skeletons.
- One item / many items: 1 photo, and 30 mixed files that land over about 2 minutes under the rate limit.
- Very long names: 240-character file names are cut by `validateFileName`. Emoji, RTL and CJK names keep their characters.
- Error: unsupported or failed parts are skipped silently, and there's no card in an error state.
- Rate-limited: cards past the 30-per-minute budget arrive after `retryAt`. There's no user-facing message.

## Scenario seed packs

- `email-attachments` `.eml` fixtures:
  - 1 JPEG; 30 mixed attachments (PDF, DOCX, PNG, HEIC, MP3, MOV, ZIP)
  - an iPhone Mail photo sent inline, and a signature logo referenced by cid
  - `.exe` and `.ics` attachments, and `smime.p7s`
  - a 24 MiB PDF, a zero-byte file, and duplicate file names
  - an account at 195 cards with 10 attachments

## Break-it checklist

- Worker:
  - a PUT failing, then succeeding
  - a URL expiring mid-upload
  - Convex returning no `uploads` (old backend)
  - a finalize retried twice (one card), and two finalizes for the same index at once (one card, the other gets `IN_PROGRESS`)
  - a forged `fileKey` for another user or index (refused)
- Backend:
  - quota boundary mid-email (5 saved, 5 dropped and their objects removed)
  - an empty rate bucket (scheduled retry)
  - a receipt replay
  - account deletion while attachments are pending
  - a card hard delete removing the R2 object
- UI: 30 cards arriving while the grid is open, at 390px, and both themes.

## Tests

- `apps/email-worker/src/attachments.test.ts`: the selection table (inline, decoration, signature parts, cap).
- `apps/email-worker/src/index.test.ts`: the upload and finalize sequence, PUT retries, and the old-backend path (fetch mocked).
- `packages/convex/inboundEmail.test.ts` (extend): minting skips bad formats, finalize is idempotent (sequentially, and with two concurrent finalizes for one index, which create exactly one card and return `IN_PROGRESS` to the loser), a stale `pending` claim is reclaimed, an interruption injected after card creation leaves the index `done` with that card (no duplicate on retry), an interruption after promotion but before card creation finishes on retry from the already-promoted object, a forged key is refused, a quota drop deletes the pending object, `RATE_LIMITED` reschedules, and a finalized attachment's card `fileKey` sits under the permanent `stored` prefix, not `upload-pending-v2`. The test runs the stale-pending sweep afterwards, and the file must still exist.
- `packages/convex/__tests__/publicApiUploads.test.ts`: `mintPendingUpload` behaves as before for the API.
- `packages/tests/src/journey/14-email-in.e2e.ts`: a signed fixture with 2 attachments produces 2 file cards tagged `email`.

## Proof before the PR

- Video 1: forward an email with a PDF and two photos from a phone, and see three file cards plus the body note.
- Video 2: send 30 attachments to an account at 195 cards. 5 cards appear, and the rest are dropped with no reply.
- Screenshots: the resulting grid and the card detail of an attachment, light and dark, 390px and 1440px.
- Worker and Convex logs for a run, showing skip reasons and no content.

## Release gate

1. Run the narrow tests above, then the repo checks and `14-email-in.e2e.ts`.
2. Seed `email-attachments`, run the break-it pass, and fix with regression tests.
3. Send the proof bundle.
4. Deploy `apps/email-worker` first. Unknown fields are tolerated, and the old Convex returns no `uploads`, so attachments are simply skipped until Convex ships. Then open the PR, get CI green, and merge (Convex, then web). No backfill.
5. Smoke-test production: send one email with a PDF to a test account and confirm the card, its thumbnail and the R2 object, then hard-delete it and confirm the object is gone.

## Risks And Open Questions

- Cloudflare's 25 MiB message cap is far below the 100 MB file limit. Docs should say "up to about 18 MB of attachments per email".
- Worker CPU and memory on a 25 MiB message: measure in the spike. Raise `limits.cpu_ms` only if needed.
- Should attachment cards also carry the email subject in `notes`? Proposed no, to keep the cards clean.
