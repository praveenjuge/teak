import { writeAccountLocale } from "../settings/preferences";
import { FREE_TIER_LIMIT } from "../shared/constants";
import { AI_LANGUAGES_TAG, aiLanguagesScenarioCards } from "./aiLanguages";
import {
  READER_MIX_TAG,
  READER_SEARCH_SHARED_PHRASE,
  seedReaderMix,
  seedReaderSearchPage,
} from "./articles";
import {
  CARD_DETAILS_SCENARIO_CARDS,
  PINNED_SCENARIO_CARDS,
  TAGS_CASE_SCENARIO_CARDS,
} from "./cardScenarios";
import {
  checklistsPack,
  doneStatesPack,
  focusNotesPack,
  hiddenMixPack,
  noteTablesPack,
  OCR_LEASE_PHRASE,
  OCR_SHARED_KEYWORD,
  ocrDocumentsPack,
  ocrImagesPack,
  ocrLinksPack,
  omniboxTitlesPack,
  revisitSizesPack,
  SAVE_DETAILS_SAVED_URL,
  saveDetailsPack,
} from "./contentPacks";
import { deadLinksOrigin, seedDeadLinks } from "./deadLinks";
import {
  cardIn50FoldersPack,
  exportUglyPack,
  folderRulesPack,
  folders500Pack,
  foldersOnePack,
  foldersUglyPack,
  paletteMixedPack,
  searchQualifiersPack,
  smartFoldersPack,
} from "./folderPacks";
import { seedHighlightsMix } from "./highlights";
import { CARD_LINK_SCENARIO_DESCRIPTIONS, seedCardLinkScenario } from "./links";
import {
  emailAttachmentsPack,
  emailInPack,
  podcastTranscriptsPack,
  richSitesPack,
  turnOnSaveByEmail,
  videoCaptionsPack,
} from "./mediaPacks";
import { orderingSavedPack } from "./orderingSaved";
import {
  cardsPack,
  fillPack,
  firstPageOnly,
  folderPack,
  type ScenarioPack,
} from "./packs";
import { PAGE_ARCHIVE_MIX_TAG, seedPageArchiveMix } from "./pageArchives";
import {
  PASTE_LINKS_KNOWN,
  PASTE_LINKS_LIBRARY_SIZE,
  RESAVE_AT_LIMIT_LINKS,
  resavePack,
} from "./resave";
import { searchOperatorsPack } from "./searchOperators";
import { urlVariantsScenarioPage } from "./urlVariants";
import {
  archiveMixScenarioPage,
  doneStatesImagesPage,
  hiddenMixVolumePage,
  KEYBOARD_MIXED_SCENARIO_SIZE,
  keyboardMixedScenarioCard,
  orderingScenarioPage,
  searchQualifiersVolumePage,
  shufflePartialScenarioPage,
  tags2000ScenarioPage,
} from "./volumeScenarios";

/**
 * Every pack `devSeed:seedScenario` can seed, in the order its help lists
 * them. A new pack is one entry here; its cards live in the module beside it.
 * The list in `adding-a-feature.mdx` names the same packs
 * (`scripts/repo/seed-packs-docs.test.ts`).
 */
export const SCENARIOS: readonly ScenarioPack[] = [
  cardsPack(
    "card-details",
    "Link bylines in every shape pages send them. Images with and without EXIF need stored files, so upload those through the API.",
    () => CARD_DETAILS_SCENARIO_CARDS
  ),
  cardsPack(
    "pinned",
    "Eleven notes pinned in order (the third also a favorite) and two more unpinned, so the 12-card pin cap is one pin away. Search `#scenario-pinned`.",
    firstPageOnly(PINNED_SCENARIO_CARDS)
  ),
  cardsPack(
    "ordering",
    "1,000 cards saved over ten years but inserted in shuffled order; each names its index and saved date. 200 per page.",
    orderingScenarioPage
  ),
  cardsPack(
    "archive-mix",
    "1,000 cards in every library state: every fifth archived, 20 of those also in Trash, 100 more only in Trash, every seventh a favorite, tags differing only by case. 200 per page.",
    archiveMixScenarioPage
  ),
  cardsPack(
    "tags-2000",
    "1,000 cards carrying 2,000 distinct tags, plus shared design, reference and inspiration tags. 200 per page.",
    tags2000ScenarioPage
  ),
  cardsPack(
    "tags-case",
    "One tag in three casings across user and AI tags on active, archived and trashed cards, beside emoji, RTL, CJK and 64-character tags.",
    firstPageOnly(TAGS_CASE_SCENARIO_CARDS)
  ),
  folderPack(
    "folders-one",
    "One folder holding active, archived and trashed cards, beside cards in no folder.",
    foldersOnePack
  ),
  folderPack(
    "folders-500",
    "The 500-folder cap: the first holds a few cards, the rest are empty, every tenth uncolored.",
    folders500Pack
  ),
  folderPack(
    "card-in-50-folders",
    "One card in 50 folders, one in 49, and a 51st folder neither is in, so adding the full card to it is refused.",
    cardIn50FoldersPack
  ),
  folderPack(
    "folders-ugly",
    'Awkward folder names, one card each; case-only variants of "Ideas" share a folder, and two cards are archived or in Trash.',
    foldersUglyPack
  ),
  folderPack(
    "search-qualifiers",
    "Links on 30 hosts written every way site: must match, tags in several casings and hex-shaped names, folders with spaces and quotes, and favorite, archived and trashed cards.",
    searchQualifiersPack
  ),
  cardsPack(
    "search-qualifiers-1000",
    "1,000 links, nine in ten on one host, so qualifiers page through more than one scan budget. 200 per page.",
    searchQualifiersVolumePage
  ),
  folderPack(
    "folder-rules",
    "A folder for each rule shape, run as a save runs them: tags only with a card inside to tag, a search matching two typography cards, tags and a search with a sourdough card to file, a paused search, and a folder whose secret tag hides its cards.",
    folderRulesPack
  ),
  folderPack(
    "smart-folders",
    "Smart folders matching nothing, the whole pack, exactly one card, a manual folder's favorites, design links, an emoji, an RTL and a 500-character search.",
    smartFoldersPack
  ),
  folderPack(
    "checklists",
    "Task lists for checklist sorting: 10 and 200 items, 5 levels of nesting, bullets beside tasks, all done, odd spacing and a table (both open as literal Markdown), and a checklist in a blockquote.",
    checklistsPack
  ),
  folderPack(
    "note-tables",
    "12 notes with GFM tables: 3×3, 20 columns by 200 rows, formatting in cells, escaped pipes, CJK and RTL cells, a table beside a checklist and a link, a 510 KiB note, a note that is only a table and two tables back to back, plus an aligned, a ragged and a quoted table that stay literal Markdown.",
    noteTablesPack
  ),
  folderPack(
    "search-operators",
    '400 cards for -, OR and parentheses: "design" with and without "figma", the tags fonts, type and Fonts, images and links on github.com and gitlab.com (some archived), hidden cards, cards in Inbox and Reading list, priced products and receipts reading "total due", plus smart folders "Fonts or type", "Operators, not archived" and "GitHub or GitLab".',
    searchOperatorsPack
  ),
  folderPack(
    "hidden-mix",
    "Cards hidden by secret and hidden tags in odd case and spacing: a favorite, an archived, a trashed, a foldered and a site: one, smart folders with and without #secret, and a card whose hidden is only an AI tag. Seed it on two accounts to test ownership.",
    hiddenMixPack
  ),
  folderPack(
    "revisit-sizes",
    "Revisit deck sizes: tags rv1, rv19, rv20 and rv21 mixing every card type (a very tall image, video, audio, a 300-character title), each with one secret card a deck must never deal; rv0 holds only that hidden card. Seed ordering too for 1,000 cards.",
    revisitSizesPack
  ),
  folderPack(
    "save-details",
    `Text saved from pages (one at www.example.com, a 300-character and an RTL page title, an international host), a link with a source beside its own URL, and ${SAVE_DETAILS_SAVED_URL} already saved with tags and a note for the extension's duplicate check.`,
    saveDetailsPack
  ),
  folderPack(
    "omnibox-titles",
    "Titles for the extension's address-bar suggestions: &, <script>, quotes, 1 < 2 > 0 in a note saved from a page, 300 characters, emoji, RTL, CJK and an empty title (shown as the host), plus a secret card that must never be suggested. Search `#scenario-omnibox-titles`; seed ordering too for many results.",
    omniboxTitlesPack
  ),
  folderPack(
    "ocr-images",
    `40 images and video thumbnails with their text already read: receipts, code, memes, handwriting, Arabic, Hebrew, Japanese, Hindi, Korean and Russian signs, a 4,000-character wall of text and photos with none, plus twin notes that share a word with an image (${OCR_SHARED_KEYWORD}, "total due", Tokyo Station, fizzbuzz). Compare \`${OCR_SHARED_KEYWORD}\` with \`text:${OCR_SHARED_KEYWORD}\`.`,
    ocrImagesPack
  ),
  folderPack(
    "ocr-documents",
    `Scanned PDFs with their first pages already read: a lease whose page 2 says "Lease agreement", a 300-page archive, a scan with only a "Scanned by" footer, Arabic and Chinese scans, and unread controls (a text PDF, a password-protected PDF), plus a twin note. Compare \`${OCR_LEASE_PHRASE}\` with \`text:lease\`.`,
    ocrDocumentsPack
  ),
  folderPack(
    "ocr-links",
    'Links whose preview image and screenshot were already read: a talk\'s slide title, a docs page, a code-heavy blog post, an RTL news site, and a single-page app that rendered blank, plus a twin note. Compare `scaling postgres` with `text:"scaling postgres"`.',
    ocrLinksPack
  ),
  fillPack(
    "card-limit-199",
    "Fills a free account's library to 199 cards, one under the free limit, so the next save is its last. Run it again after saving and it adds nothing.",
    FREE_TIER_LIMIT - 1
  ),
  cardsPack(
    "hidden-mix-1000",
    "The ordering pack's 1,000 cards with every fifth (200) tagged secret, for paging and Shuffle past hidden cards. 200 per page.",
    hiddenMixVolumePage
  ),
  folderPack(
    "export-ugly",
    "Titles and folder names an export must write safely (quotes, commas, newlines, markup, formulas, emoji, RTL, CJK), a link in 50 folders, archived and favorite cards, with and without AI fields.",
    exportUglyPack
  ),
  folderPack(
    "focus-notes",
    "Text notes for Focus mode: a 50,000-word draft, an aligned table that opens as literal Markdown beside a code block, an empty note, CJK and RTL text, and a 300-character first line.",
    focusNotesPack
  ),
  folderPack(
    "palette-mixed",
    "50 folders and 10 smart folders with emoji, RTL, CJK, 300-character and case-only-different names, and marker cards (one archived, one in Trash) for the command palette; seed ordering too for 1,000 cards.",
    paletteMixedPack
  ),
  cardsPack(
    "keyboard-mixed",
    "48 cards of very different heights, so arrow keys in the masonry grid must pick the visually nearest card.",
    firstPageOnly(
      Array.from({ length: KEYBOARD_MIXED_SCENARIO_SIZE }, (_, index) =>
        keyboardMixedScenarioCard(index)
      )
    )
  ),
  folderPack(
    "done-states",
    'One link per category, every other one marked done; done links in Trash and Archive; a link with no category yet; done links with 300-character, RTL and CJK titles; and a smart folder `is:todo folder:"Reading list"`.',
    doneStatesPack
  ),
  folderPack(
    "rich-sites",
    "Links with details from their sites: Wikipedia (English, a disambiguation page, Japanese, a missing page), arXiv (a paper with a PDF to save, an old-style id, a withdrawn paper, 300 authors), Spotify (track, album, playlist, region-locked), Apple Music, and books with an ISBN-13, an ISBN-10, none, a bad check digit and one Open Library doesn't know. Search `#scenario-rich-sites`.",
    richSitesPack
  ),
  folderPack(
    "video-captions",
    "YouTube links with Channel, Length and Uploaded facts (a talk, a Short, a live stream with no length), and Vimeo links with transcripts as captions give them (English, unlisted, Japanese, a two-hour lecture whose line at minute 90 is searchable), a private Vimeo video with none, and a Vimeo link saved as a note. YouTube captions aren't read. Search `#scenario-video-captions`.",
    videoCaptionsPack
  ),
  folderPack(
    "podcast-transcripts",
    "Podcast episode links with transcripts as Whisper gives them (og:audio, Apple Podcasts, an RSS-only show, a Japanese episode, one in Trash), and episodes that get none (Spotify, a 2 GB file). Search `#scenario-podcast-transcripts` or a spoken phrase such as `hermit crab`.",
    podcastTranscriptsPack
  ),
  {
    name: "card-links",
    description: CARD_LINK_SCENARIO_DESCRIPTIONS["card-links"],
    seed: (ctx, userId) => seedCardLinkScenario(ctx, userId, "card-links"),
  },
  {
    name: "backlinks",
    description: CARD_LINK_SCENARIO_DESCRIPTIONS.backlinks,
    seed: (ctx, userId) => seedCardLinkScenario(ctx, userId, "backlinks"),
  },
  folderPack(
    "email-in",
    "Cards as Save by email makes them, all tagged email: a newsletter with 40 tracking pixels and four kinds of redirect, a link with a sentence (a link card with a note), a subject with no body, a five-level forward chain, RTL, CJK and emoji subjects, and two links (a note). Also turns Save by email on. Search `#scenario-email-in` or `#email`.",
    emailInPack,
    turnOnSaveByEmail
  ),
  folderPack(
    "email-attachments",
    "An email's body note and its attachments as their own document cards, tagged email: PDFs, two with the same name, a CJK name, a Word file and a 24 MB report. Search `#scenario-email-attachments`.",
    emailAttachmentsPack
  ),
  folderPack(
    "ordering-saved",
    'Cards saved again after they were first saved (savedAt later than createdAt), in the folder "Saved again", tagged, and the links on ordering-saved.example.com: one first saved 400 days ago and saved again yesterday (a favorite), cards saved 2, 30 and 730 days ago and never again, two archived (one saved again 3 days ago) and one in Trash saved again 5 days ago. Newest first puts the one saved yesterday on top; `last week` finds it. Dates are relative to when it is seeded. Search `#scenario-ordering-saved`.',
    orderingSavedPack
  ),
  cardsPack(
    "done-states-images",
    "1,000 image cards and no links, so `is:todo` lists nothing. Seed it on an account without links. 200 per page.",
    doneStatesImagesPage
  ),
  cardsPack(
    "url-variants",
    "50 links that exercise the duplicate check's URL key: http and https, www, a trailing slash, #fragment, #/ and #! routes, utm_*, fbclid and gclid, near misses that must stay apart (?id=1 and ?id=2, parameter order, the path's case, :8080), an IDN host, a percent-encoded path, a 2,000-character address, two cards for one link, an archived and a trashed one. Each is seeded under /k/ with a key and under /l/ without one, for the exact-address fallback. Search `#scenario-url-variants`.",
    urlVariantsScenarioPage
  ),
  folderPack(
    "resave",
    "Links to save again: 300 spread over three years with known keys (example.com/resave/001 to /300, every 15th archived), five only in Trash (saving one makes a new card), one in three folders and tagged reading (/resave/reading), and one saved with utm_source (save /resave/utm-variant to move it). Search `#scenario-resave`; seed resave-at-limit on a free account for the card limit.",
    resavePack
  ),
  fillPack(
    "resave-at-limit",
    "A free account at the card limit (200 of 200) whose cards include five links to save again (example.com/resave-limit/1 to /5, the fifth archived): saving one moves it to the top, and a new link is refused. Search `#scenario-resave-at-limit`.",
    FREE_TIER_LIMIT,
    RESAVE_AT_LIMIT_LINKS
  ),
  fillPack(
    "paste-links",
    "A free account with 195 cards, five under the limit, among them ten links (example.com/paste-links/1 to /10, the 3rd and 7th archived) that the composer's fixture paste lists repeat. Paste twelve links that start with known ones: the known links move to the top, five new ones are saved, and the job stops at the limit. Search `#scenario-paste-links`.",
    PASTE_LINKS_LIBRARY_SIZE,
    PASTE_LINKS_KNOWN
  ),
  {
    name: "dead-links",
    description:
      "Link cards with archived copies whose pages are gone or not: 404, 410, a domain that no longer exists (opens the copy), 403, 500, a page that answers after 6 seconds and a live one (open the original), plus a 404 with no copy (opens directly), one in Trash and a text-only copy. They point at httpbin.org unless `origin` names a server that answers `/status/<code>` and `/delay/<s>`. The copies are small pages written through the Core Worker. Search `#scenario-dead-links`.",
    seed: (ctx, userId, { origin }) =>
      seedDeadLinks(ctx, userId, deadLinksOrigin(origin)),
  },
  {
    name: "locale-switch",
    description:
      "No cards: sets the account's language to German (de), as Settings → Language would. Set the browser's teak-locale cookie to ja first to see the account win on the next load; seed again with `en` restored from Settings to undo.",
    seed: async (ctx, userId) => {
      await writeAccountLocale(ctx, userId, "de");
      return { status: "seeded", cards: 0 };
    },
  },
  cardsPack(
    "ai-languages",
    `Notes in Japanese, Spanish, German, Korean, Chinese, Hindi and Arabic, an English note with a Spanish quote, one with no words at all, and French and Portuguese Wikipedia links, all run through AI processing so their tags and summary come back in the content's language. Images, PDFs and audio need uploaded files, so they aren't seeded. Search \`#${AI_LANGUAGES_TAG}\`; \`bun --no-env-file run scripts/seed/ai-language-check.ts\` scores it.`,
    firstPageOnly(aiLanguagesScenarioCards())
  ),
  {
    name: "page-archive-mix",
    description: `Links in every state of their saved copy: a full 40 KB copy with inlined images, a text-only copy, two that failed (blocked_url, too_large), one still saving, one sent by the extension, one in Trash, and a podcast episode with a copy and a transcript. The copies are stub files written through the Core Worker. Search \`#${PAGE_ARCHIVE_MIX_TAG}\`.`,
    seed: (ctx, userId) => seedPageArchiveMix(ctx, userId),
  },
  {
    name: "reader-mix",
    description: `Links for the Read tab in every state: a 3,000-word article with images, code, a wide table and a quote, a news story, a research abstract, a product page that isn't an article, a text-only copy's article, Arabic and Japanese articles, an article cut at 512 KiB characters, one still being prepared, one that failed, and a podcast with an article and a transcript. Copies, Markdown and images are written through the Core Worker. Search \`#${READER_MIX_TAG}\`.`,
    seed: (ctx, userId) => seedReaderMix(ctx, userId),
  },
  {
    name: "highlights-mix",
    description: `Highlights on the reader-mix articles (seed reader-mix first and wait for its articles): the long read at the cap of 200, the news story with 12 (some with notes, one of 2,000 characters), the research abstract with 1, a quote repeated in every paragraph highlighted the third time, three imported highlights on the text-only article waiting for their article (one never matches), Arabic and Japanese highlights (the Japanese one merged from two overlapping requests), and a highlighted podcast episode to refresh, whose saved copy must stay. Search \`#${READER_MIX_TAG}\`.`,
    seed: (ctx, userId) => seedHighlightsMix(ctx, userId),
  },
  {
    name: "reader-search-1000",
    description: `1,000 links with articles titled "Field note 1" to "Field note 1000". Only their body text has "${READER_SEARCH_SHARED_PHRASE}" (all of them) and lantern0 to lantern999 (one each), so search finds them by article text alone. Their Markdown isn't written, so the Read tab can't load it. 200 per page.`,
    seed: (ctx, userId, { page }) => seedReaderSearchPage(ctx, userId, page),
  },
  cardsPack(
    "shuffle-partial",
    "400 cards, 300 without a Shuffle key as before its backfill; Shuffle must still show each card once. 200 per page.",
    shufflePartialScenarioPage
  ),
];
