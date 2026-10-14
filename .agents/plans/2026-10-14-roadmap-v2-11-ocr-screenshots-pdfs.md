## Goal

Extend OCR to link screenshots and scanned PDFs. A link's rendered screenshot is read after capture. A PDF with no usable text layer has its first 3 pages rendered and read, and that text then feeds its summary, its tags, `aiOcrText` and v1 phase 13's stored text. Both are backfilled. Phase 11 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 10](2026-10-14-roadmap-v2-10-ocr-images.md): `aiOcrText`, `ocrCheckedAt`, the `search_ocrText` index, `text:`, `MAX_IMAGE_OCR_CHARS` and the "Text in image" block.
- [v1 phase 13](2026-10-12-roadmap-13-stored-text.md): `cardTextContents`, `documentTextKey`, `hasExtractedText` and `GET /v1/cards/:id/content`.

## Success Criteria

- A scanned PDF whose page 2 says "Lease agreement" is found by `lease agreement` and by `text:lease`. It gets a real AI summary and tags instead of only its file name. `teak content <id>` prints the OCR text.
- A PDF with a real text layer is untouched: no rendering and no vision calls.
- A link card whose screenshot shows text gets `aiOcrText` after the screenshot lands. A failed OCR never fails the screenshot stage.
- The panel block reads "Text in screenshot" for links and "Text from scanned pages" for PDFs.
- Two dry-run-first backfills cover existing link screenshots and scanned PDFs.

## Context And Current Facts

- Link screenshots are not part of `cardProcessingWorkflow`. Here is the chain:
  1. The metadata step (`workflows/steps/metadata.ts`, end of `generateHandler`) schedules `workflows/screenshot.startScreenshotWorkflow` for links.
  2. `screenshotWorkflowHandler` (`workflows/screenshot.ts`) runs `steps/screenshot/captureScreenshot`.
  3. The capture stores a 1280×720 JPEG (`FILES_SCREENSHOT_SIZE`, `files-protocol/src/rendering.ts`) at `metadata.linkPreview.screenshotStorageKey` through `linkMetadata.updateCardScreenshot`.
  4. The `screenshot` processing stage is recorded with `stageCompleted` or `stageFailed`.
- Screenshots render offline. `apps/files-worker/src/browserRender.ts` aborts every network request and blocks WebSockets, so images, web fonts and external CSS never load. The capture only sees HTML that Convex fetched through `safeFetch`. Pages built by JavaScript often render blank.
- `captureScreenshot` returns `skipped` when a screenshot already exists and `retryCount === 0`. Refresh details reruns the whole pipeline.
- PDF text comes from `extractFileTextForAiForKey` (`workflows/fileProcessing.ts`). It uses the `inspect` op in `pdf` mode, which `extractPdfTextViaRenderer` in `apps/files-worker/src/mediaJobs.ts` handles:
  - It reads at most `MAX_PDF_TEXT_PAGES = 50` pages and `MAX_AI_TEXT_CHARACTERS` = 512 KiB.
  - It returns `facts.pageCount` when it gets that far.
  - It returns `""` for an encrypted or undecodable PDF, or one over `FILES_RENDER_MAX_SOURCE_BYTES` = 100 MiB.
  - `extractFileTextForAiForKey` returns only the text and drops the facts, so "no text layer" cannot be told apart from "could not read".
- The renderer Container only renders **page 1**:
  - `POST /pdf/page?max` (`container/src/server.ts`), with `pdfPageParams` allowing only `max`.
  - `pdfPageJob` in `container/src/jobs/pdf.ts`.
  - `renderPdfPage` writes the PNG to R2 for `render-pdf-thumbnail`.
  - Pages 2–3 need a container change, and a new image rolls out after the worker deploys (`check-files-readiness.ts --wait`).
- Document renderables (the page-1 thumbnail) run in parallel with the metadata step for non-image types (`cardProcessing.ts`), so the metadata step cannot rely on the thumbnail existing.
- After v1 phase 13, the document branch of the metadata step stores the extracted text (`cardTextContents { kind: "document" | "transcript", text, … }`, R2 role `document-text`) and sets `hasExtractedText`.
- `OP_TIMEOUT_MS` gives `inspect` with `mode: "pdf"` 90 s. New ops need their own entries.

## Constraints And Non-goals

- Two new ops go into `FILES_OPS`, `apps/files-worker/src/ops.ts`, `OP_TIMEOUT_MS` and the `required` list in `scripts/check-files-readiness.ts`. The worker deploys first.
  - `extract-image-text` takes `{ sourceKey }` and returns `{ text }`. It uses Gemma with an OCR-only prompt and the same capacity and validation retries as `generateImageMetadataForOp`. Timeout 120 s.
  - `ocr-pdf-pages` takes `{ sourceKey, maxPages ≤ 3 }` and returns `{ text, pagesRead, pageCount }`. It renders each page in memory and runs Gemma on it, writing nothing to R2, so no new R2 keys are created. Timeout 240 s.
- A PDF counts as scanned when its page count is known and the extracted text averages under 20 letters or digits per page across the pages read. A "Scanned by …" footer alone still counts as scanned.
- At most 3 pages are read, whatever the PDF's length. The text is cut at `MAX_IMAGE_OCR_CHARS`, with `--- Page N ---` separators.
- Rendering and OCR happen inside the existing metadata step (no new `cardProcessing` step). Screenshot OCR is a new final step in `screenshotWorkflowHandler`, after the stage is recorded.
- Out of scope: OCR of a link's `og:image`, Word and PowerPoint files that contain only images, and PDFs over 100 MiB.

## Files Worker

- Container:
  - `pdfPageParams` takes `page` (1–3, default 1).
  - `pdfPageCommand` renders `-f page -l page`.
  - `extra.pages` still reports the page count.
- `mediaJobs.ts`: add `renderPdfPageBytes(env, sourceKey, page)`, which returns the PNG bytes and does not write to R2.
- `imageMetadata.ts`:
  - Factor the model loop into `runVisionJson(env, imageBytes, systemPrompt, parse)`.
  - Add `IMAGE_TEXT_SYSTEM_PROMPT`, which answers `{"text": "..."}`.
  - `extract-image-text` fetches the `detail` rendition the same way `generateImageMetadataForOp` does.
- `ocr-pdf-pages`: pages run one after another, which keeps one renderer slot per call. A `RendererDeclined` result (password protected, no pages) returns `{ text: "" }`.

## Backend

- `fileProcessing.ts`: `extractFileTextForAiForKey` also returns `pageCount`. Callers keep using the text.
- `steps/metadata.ts`, document branch:
  - When the PDF counts as scanned, call `ocrPdfPagesForStoredKey`.
  - When it returns text:
    - pass it as the content for `generateTextMetadata`
    - set `aiOcrText` and `ocrCheckedAt`
    - store it through v1 phase 13's path as `cardTextContents { kind: "document", fromOcr: true }`
  - A renderer that is busy throws so the step retries. A declined render completes with today's behavior.
- `cardTextContents`: add `fromOcr: v.optional(v.literal(true))`, so `GET /content` can label it.
- `workflows/steps/screenshot/ocrScreenshot.ts` (new `internalAction`):
  - Reads `screenshotStorageKey`, calls `extract-image-text`, and writes through a mutation that uses `patchCardWithSearchSync`.
  - It writes only if the card still has the same screenshot key and is not trashed.
  - `screenshotWorkflowHandler` runs it after `recordStage(stageCompleted)` inside a try/catch. Failures are logged and leave the stage as `completed`.
- `migration/backfillLinkScreenshotOcr.ts` covers link cards with a `screenshotStorageKey` and no `ocrCheckedAt`. `migration/backfillPdfOcr.ts` covers PDF document cards with no `ocrCheckedAt` that pass the same `isScannedPdf` predicate the pipeline uses (page count known and fewer than 20 letters or digits per page on average). It does not filter on `hasExtractedText` alone, because a scan with only a "Scanned by …" footer has `hasExtractedText` set yet still counts as scanned. The predicate reads the stored text length and page count, so selecting candidates needs no extra worker calls. For both:
  - Dry run by default.
  - Pages of 25, with one action every 3 s.
  - Accounts being deleted are skipped.
  - The PDF backfill also regenerates the summary and tags, because those were built from the file name alone.

## Web

- `CardMetadataPanel.tsx`: the block title depends on the card: "Text in image", "Text in screenshot" or "Text from scanned pages". It shows a muted "First 3 pages" note when `pageCount > 3`.
- No other UI change; search already covers `aiOcrText` from phase 10.

## API / MCP / SDK / CLI

- `GET /v1/cards/:id/content` gains `source: "text" | "ocr"` (additive). The same goes for the MCP `teak_v1_get_card_content` result, the SDK `cards.content` type, and `teak content` with `--json`.
- `publicApiOpenApi.ts`: document `source`. Nothing else changes; `aiOcrText` already ships.

## Docs

- `features.mdx`: OCR covers link screenshots and the first 3 pages of scanned PDFs.
- `(developers)/api.mdx` and `mcp.mdx`: the `source` field.
- Ship-month changelog: "Scanned PDFs are searchable".

## UI states

- Empty: a text-only PDF or a blank screenshot shows no block.
- Loading: none; the card shows its processing state as today.
- One item / many items: n/a.
- Very long: 3 pages of dense text clamp like phase 10. A 300-page scan shows "First 3 pages".
- Error: password-protected or broken PDFs and failed screenshot OCR leave the card as today.
- Rate-limited: none; background work only.

## Scenario seed packs

- `ocr-documents` on the dev deployment, using real files:
  - A 300-page scanned PDF, a 2-page scan with a "Scanned by" footer, and a mixed PDF (text page 1, scanned page 2, which keeps its text layer).
  - A password-protected PDF, a 99 MiB scan, and scans in Arabic and Chinese.
  - Text-PDF controls.
- `ocr-links`: a code-heavy blog post, a docs page, a single-page JavaScript app (blank render), a 2 MiB HTML page, and an RTL news site. Seeded `aiOcrText` link cards for the search checks.

## Break-it checklist

- UI:
  - Open a card while OCR lands, and confirm the block appears with no layout jump.
  - Refresh details on a scanned PDF twice quickly (rate limit).
  - Check the 390px panel.
- Backend:
  - Scanned detection on 0, 1 and 3+ pages, and on footer-only text.
  - A busy renderer is retried. A declined render completes.
  - A screenshot replaced mid-OCR is not written.
  - A card trashed or hard-deleted mid-OCR is not written.
  - An old worker without the new ops: the ops are treated as missing and skipped, with no failure loops.
  - `GET /content` for an OCR document.
  - Account deletion while a backfill page is running.
  - Each backfill's dry-run counts, and a resume.

## Tests

- `apps/files-worker/container/test/pdf.test.ts` and `container/src/args.test.ts`: the `page` parameter and its bounds.
- `apps/files-worker/src/mediaJobs.test.ts`: `renderPdfPageBytes`.
- `apps/files-worker/src/ops.test.ts` and `index.test.ts`: both ops are dispatched, validated and listed in capabilities.
- `apps/files-worker/src/imageMetadata.test.ts`: the OCR-only parser.
- `packages/convex/__tests__/workflows/fileProcessing.test.ts`: `pageCount` is passed through.
- `packages/convex/__tests__/workflows/steps/metadata.test.ts`: scanned PDF leads to OCR text, summary and stored text; a text PDF makes no OCR call; a declined render.
- `packages/convex/__tests__/workflows/screenshot.test.ts`: the OCR step runs after capture, its failure keeps the stage `completed`, and a replaced key is not written.
- `packages/convex/__tests__/migration/backfillPdfOcr.test.ts` and `backfillLinkScreenshotOcr.test.ts`: the dry run writes nothing; pages resume; a PDF with a short "Scanned by …" footer (`hasExtractedText` true, under 20 characters per page) is selected, and a normal text PDF is not.
- `packages/convex/__tests__/card/content.test.ts` and `__tests__/publicApiHttpCards.test.ts`: `source: "ocr"`.
- `packages/ui/src/components/card-modal/__tests__/CardMetadataPanel.test.tsx`: the titles and the "First 3 pages" note.

## Proof before the PR

- Video 1: upload a scanned lease PDF on dev, search a phrase from page 2, open the card, and run `teak content <id>`.
- Video 2: save a docs link, wait for the screenshot, then `text:` search a heading that appears only in the screenshot.
- Screenshots of all three block titles: light and dark, 390px and 1440px.
- Captured `/v1/cards/:id/content` output, the MCP output, and both backfill dry-run reports.

## Release gate

1. The narrow tests above, then the repo checks and the e2e journeys `03-api`, `04-cli` and `05-mcp`. Break the scanned-PDF check on purpose and confirm the tests fail.
2. Upload the `ocr-documents` and `ocr-links` packs on dev, run the break-it pass, and fix every bug with a regression test.
3. Send the proof bundle.
4. PR, green CI, merge. Then:
   1. Deploy the Files Worker (dev, then prod).
   2. Run `scripts/check-files-readiness.ts --prod --wait` until the new renderer image is healthy and both ops are listed.
   3. Deploy Convex, then web.
   4. Run `backfillPdfOcr` as a dry run, then in pages. Then run `backfillLinkScreenshotOcr` as a dry run, then in pages. One backfill at a time.
   5. Smoke-test in production with a scanned PDF and a link.

## Risks And Open Questions

- **Contradiction.** The master plan treats link screenshots as an OCR source on a par with images. Because screenshots render offline (no images, no web fonts, no external CSS), their OCR mostly repeats text that is already in the HTML, and JavaScript-built pages come out blank. Open question for the owner: should the link's `og:image` (`linkPreview.imageStorageKey`) also be read? It is a real image already in R2.
- **Cost.** Up to 3 renderer jobs and 3 Gemma calls per scanned PDF. Renderer slots (`max_instances: 4`) are shared with thumbnails and audio, so the backfill must stay slow.
- **Hallucination.** Handwriting can be misread or invented. The block is labelled as text read from the image, and the text is never shown as the card's content.
