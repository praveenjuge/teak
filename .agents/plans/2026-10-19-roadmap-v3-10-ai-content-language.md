## Goal

Write AI summaries and AI tags in the language of the saved item. A Japanese article gets a Japanese summary and Japanese tags, and a Spanish note gets Spanish ones. Items with no text (a photo with no words) stay English. Phase 10 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing in v3. It is listed under Localization, but it doesn't use the phase 9 UI work and can ship before or after it.

## Success Criteria

- **New cards and Refresh details:**
  - Summaries and AI tags are in the content's main language for text, link, document, audio, video and image cards with legible text.
  - Mixed-language content uses its main language.
  - Content with no language signal stays English.
- **What doesn't change:**
  - Visual style labels (`minimal`, `cinematic` and so on) stay English, because they are a fixed vocabulary used by `mood:` and filters.
  - The link category, Clef decisions and the read-from-image text (already kept in its original language) are unchanged.
- **The language is stored:** each card's AI language is stored as an optional `aiLanguage` (a BCP-47 primary tag such as `ja`, `es` or `en`), so the change can be measured and later features can use it. No UI and no public API field in this phase.
- **Existing cards keep their English AI output.** There is no backfill.
- **Search still works across languages:**
  - Semantic search already matches across languages (`.agents/semantic-search.md`; the EmbeddingGemma evaluation included Spanish, German, Hindi and Japanese).
  - `#タグ` and `tag:diseño` work, because tag parsing and `tagKey` are not ASCII-only.

## Context And Current Facts

- **Prompts:**
  - `packages/files-protocol/src/metadata.ts:5-26`: `TEXT_ANALYSIS_SYSTEM_PROMPT` and `LINK_ANALYSIS_SYSTEM_PROMPT` ask for "5-6 specific, relevant single words only (no spaces, no hyphens)" and a 1–2 sentence summary, as JSON `{"tags": [...], "summary": "..."}`. They set no language.
  - `buildTextMetadataPrompt` (55) and `buildLinkMetadataPrompt` (62) wrap the content, and `validateTextMetadata` (73–87) accepts any strings.
  - Model: `TEXT_METADATA_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8"`, with input capped at 6,000 characters.
- **The worker picks the prompt** in `apps/files-worker/src/ai/textMetadata.ts:112-114`, by op (`generate-text-metadata` or the link op), and retries JSON validation up to `MAX_AI_METADATA_VALIDATION_RETRIES = 2`.
- **Images:** `apps/files-worker/src/images/imageMetadata.ts:27-38` `IMAGE_ANALYSIS_SYSTEM_PROMPT` (Gemma vision) returns tags, a summary and the image's text. It already says to keep the text in its original language and script (34), but sets no language for the tags and summary. It is used at 298. The separate `IMAGE_TEXT_SYSTEM_PROMPT` (309) only reads text.
- **AI tags** are cleaned by `normalizeAiTags` (`apps/files-worker/src/workflows/cardProcessing/aiMetadata.ts:38-48`): trimmed, lowercased (a no-op for CJK), with `secret`/`hidden` removed. It is called at 90 (text and link) and 165 (image).
- **Storage:** `cards.aiTags` and `cards.aiSummary` (`schema.ts:488-489`). Search tag rows merge user and AI tags (`card/searchSync.ts`).
- **Tag matching:**
  - `tagKey = trim().toLowerCase()` (`shared/tags.ts:19`).
  - `#tag` parsing (`shared/search/qualifiers.ts:366`) takes any characters after `#`.
  - So `diseño` and `デザイン` work as tags, but `design` and `diseño` are different tags.
- **Embeddings** change when a card's searchable text changes (`.agents/semantic-search.md`), so a non-English summary re-embeds through the existing path with no version bump.

## Constraints And Non-goals

- **No user setting.** The owner chose "follow the content's language" over "follow the UI language".
- **No translation of the user's own content or tags.**
- **No backfill.** A new prompt version only affects new processing and Refresh details. See the open decision.
- **CJK tags:** the "single word, no spaces" rule still holds. For Japanese, Chinese and Korean, a tag is one term with no spaces (for example `デザイン`, `设计`, `디자인`).
- **Hidden tags:** the model must never emit translated forms of `secret`/`hidden` as tags. `normalizeAiTags` already removes only the English keys; the hidden-tag rule stays English by design.
- **Analytics:** none new. Add `aiLanguage` to the existing `card_processing_completed` server event if it exists in `shared/analytics.ts` (check); otherwise only a log field.

## Files Worker

- `packages/files-protocol/src/metadata.ts`:
  - Add to both text prompts:
    ```
    - Write the tags and the summary in the same language as the content. If the content mixes languages, use the main one. If you can't tell the language, use English.
    - Language is the content's main language as a lowercase ISO 639-1 code, such as "en", "ja" or "es".
    ```
  - The JSON shape becomes `{"tags": [...], "summary": "...", "language": "xx"}`.
  - `validateTextMetadata` accepts an optional `language` matching `/^[a-z]{2,3}$/`. A missing or invalid value is dropped, not a retry, so the old output shape still passes.
  - `FilesTextMetadataResult` gains `language?: string`.
- `apps/files-worker/src/images/imageMetadata.ts` `IMAGE_ANALYSIS_SYSTEM_PROMPT`:
  - add "Write the tags and summary in the language of the text in the image. If the image has no legible text, use English.";
  - add the `language` key;
  - validate it the same way.
- `aiMetadata.ts`: pass `language` through as `aiLanguage` in the metadata write.
- **Bump the metadata prompt version wherever card processing records one.** None exists today (`grep` finds no version constant). So add `AI_METADATA_PROMPT_VERSION = 2` next to the prompts, and record it in the processing stage facts for measurement.

## Backend

- `schema.ts` `cards`: `aiLanguage: v.optional(v.string())`.
- The metadata write mutation the workflow calls stores `aiLanguage`. Refresh details overwrites it, and clears it when the model gives none.
- Not added to search documents, the public serializers or the native summaries. Export includes it in `cards.json` (one line in `export/serialize.ts`) so the data is portable.

## Web

- No UI change. Summaries and tags render as text already. Check that the side panel's AI tag chips and the summary block use `dir="auto"` and wrap CJK text without overflow at 390 px.

## API / MCP / SDK / CLI

- No change. Card responses already return `aiTags` and `aiSummary` in whatever language they are. `aiLanguage` is not exposed yet (see Risks).

## Docs

- `features.mdx` → AI enrichment: "Summaries and AI tags are written in the language of what you save. Your own tags are never changed. Items with no text get English tags."
- The changelog: "AI summaries and tags in your content's language".

## UI states

- **Mixed-language libraries:** the Tags page shows tags in several scripts, sorted by count, and long CJK tags truncate correctly.
- **Search suggestions:** tag pills in mixed scripts.
- **A card whose language can't be determined:** English output, as today.

## Scenario seed packs

- `ai-languages`. Each card has a stable expected language:
  - text notes in Japanese, Spanish, German, Korean, Simplified Chinese, Hindi and Arabic;
  - an English note with one Spanish quote;
  - link cards whose page metadata is in French and Portuguese;
  - an image with Japanese signage, and a photo with no text;
  - a PDF in German;
  - an audio note in Spanish (the Whisper transcript, then the summary).

## Break-it checklist

- **Model output:**
  - it returns tags with spaces or hyphens in CJK;
  - it returns a translated `secret` tag (`秘密`), which must not hide the card, and is acceptable as a normal tag;
  - it returns `language: "jp"` (invalid code, dropped) or `"zh-CN"` (rejected by the regex, so tighten or normalize to `zh`);
  - it omits `language`;
  - it answers in English for clearly Japanese content (measure how often).
- **Refresh details** on an old English card: it re-summarizes in the content's language, re-embeds, and leaves user tags alone.
- **Tag pages and filters** with 2,000 mixed-script tags.

## Tests

- `packages/files-protocol/src/metadata.test.ts`: the prompts include the language rules; `validateTextMetadata` keeps a valid `language` and drops invalid ones without failing.
- `apps/files-worker/src/ai/textMetadata.test.ts` and `imageMetadata.test.ts`: with the model mocked, `language` passes through, and its absence is tolerated.
- `apps/files-worker/src/workflows/cardProcessing/aiMetadata.test.ts`: `aiLanguage` reaches the write payload, and `normalizeAiTags` keeps CJK tags intact.
- `packages/convex/__tests__/export/serialize.test.ts`: `aiLanguage` is exported.
- **A live check (not CI):** a script in `scripts/` runs the `ai-languages` pack through the dev Workers AI and prints the language accuracy (expected versus `aiLanguage`, and a script check of the summary). Its output goes in the proof. Target: 90% or more for ja, es, de, ko, zh and fr.

## Proof before the PR

- **Screenshots:** card modals for the Japanese note, the Spanish link, the German PDF and the Japanese signage image (AI summary and tags in their language), and the photo with no text (English). Light and dark.
- **The live-check script's accuracy table.**
- **The Tags page** with mixed-script AI tags.

## Release gate

1. Run the narrow tests, then the repo checks.
2. Seed `ai-languages` and run the live check on dev. It must reach 90% or more for each of ja, es, de, ko, zh and fr.
3. Send the proof bundle to the owner.
4. Deploy the Files Worker, then Convex.
5. Smoke-test production by saving a Japanese article and checking the summary language.

## Risks And Open Questions

- **Tag fragmentation.**
  - What happens: a library saved in several languages gets parallel tags (`design`, `diseño`, `デザイン`). `tag:design` won't find the Spanish ones, though semantic search will.
  - Mitigations: user tags are untouched, people can merge tags by hand on the Tags page, and `aiLanguage` lets a later phase offer "AI tags in English" as a setting if fragmentation hurts.
  - Open decision: add that setting now (default: no, as the owner chose).
- **Open decision:** whether to backfill existing cards with non-English content (default: no). A backfill would re-run AI metadata for cards whose text isn't English: it costs model calls, changes tags people may rely on, and needs owner approval under `packages/convex/AGENTS.md`.
- **Open decision:** whether to expose `aiLanguage` in the public API (default: not yet; add it with a filter if there's demand).
- **Gemma and Qwen quality** in Korean and Hindi is unmeasured. The live check gates the merge, and languages under the bar fall back to English through an allow-list in the prompt builder: `ja`, `zh`, `ko`, `es`, `pt`, `de`, `fr`, `it` and `nl`, plus others that pass.
- **Search phrases:** `"quoted phrases"` match summaries by substring, which works for CJK. Free words go through Convex full-text tokenization, which may split CJK poorly. That is unchanged by this phase, and semantic search covers it.
