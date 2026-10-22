import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  getAccountDeletionState,
  initiateAccountDeletion,
} from "./accountDeletion";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
  isOnboardingCard,
  ONBOARDING_CARDS,
} from "./card/defaultCards";
import {
  CARD_DETAILS_SCENARIO_CARDS,
  TAGS_CASE_SCENARIO_CARDS,
} from "./devSeed/cardScenarios";
import {
  checklistsPack,
  doneStatesPack,
  focusNotesPack,
  hiddenMixPack,
  OCR_LEASE_PHRASE,
  OCR_SHARED_KEYWORD,
  ocrDocumentsPack,
  ocrImagesPack,
  ocrLinksPack,
  omniboxTitlesPack,
  revisitSizesPack,
  SAVE_DETAILS_SAVED_URL,
  saveDetailsPack,
} from "./devSeed/contentPacks";
import {
  cardIn50FoldersPack,
  exportUglyPack,
  type FolderScenarioPack,
  folders500Pack,
  foldersOnePack,
  foldersUglyPack,
  paletteMixedPack,
  searchQualifiersPack,
  smartFoldersPack,
} from "./devSeed/folderPacks";
import { link, palette } from "./devSeed/helpers";
import {
  CARD_LINK_SCENARIO_DESCRIPTIONS,
  type CardLinkScenario,
  seedCardLinkScenario,
} from "./devSeed/links";
import {
  emailAttachmentsPack,
  emailInPack,
  podcastTranscriptsPack,
  richSitesPack,
  videoCaptionsPack,
} from "./devSeed/mediaPacks";
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
} from "./devSeed/volumeScenarios";
import { readIsDevDeployment } from "./env";
import { insertFolder } from "./folder/folders";
import { FREE_TIER_LIMIT } from "./shared/constants";
import {
  CLOUD_DEV_ACCOUNT_EMAIL,
  CLOUD_DEV_ACCOUNT_EMAIL_RANGE,
} from "./shared/devAccounts";
import { folderNameKey, MAX_FOLDERS_PER_USER } from "./shared/folders";
import { parseSearchQuery } from "./shared/search/qualifiers";
import { isWorkosProductionApi, workosApiBase } from "./shared/workosApi";

export const DEV_SEED_CARDS: DevScenarioCardDef[] = [
  {
    type: "text",
    content:
      "Ship the smallest version that teaches us something, then look at what people actually do with it.",
    tags: ["ideas", "product"],
    isFavorited: true,
  },
  {
    type: "text",
    content:
      "Reading list for the weekend: two essays on calm technology and one long piece on how libraries organize knowledge.",
    tags: ["reading"],
  },
  {
    type: "text",
    content:
      "Grocery run: oat milk, lemons, basil, sourdough, coffee beans, dish soap.",
    tags: ["errands"],
  },
  {
    type: "text",
    content:
      "Meeting notes: move the onboarding checklist into the empty state, keep the import button visible, revisit search ranking next sprint.",
    notes: "Follow up with design on the empty state copy.",
    tags: ["work", "notes"],
  },
  {
    type: "text",
    content:
      "Recipe idea: roasted tomato soup with a spoon of miso and a handful of basil at the end.",
    tags: ["recipes"],
    isFavorited: true,
  },
  {
    type: "text",
    content:
      "A good bookmark tool should make saving instant and finding things later feel like remembering, not searching.",
    tags: ["ideas"],
  },
  {
    type: "text",
    content:
      "Gift ideas: a fountain pen, a field guide to birds, a pour-over kettle.",
    tags: ["personal"],
  },
  {
    type: "text",
    content: "Old draft I meant to throw away.",
    isDeleted: true,
  },
  link("https://docs.convex.dev/home", { tags: ["dev"], isFavorited: true }),
  link("https://workos.com/docs/authkit", { tags: ["dev"] }),
  link("https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout", {
    tags: ["dev", "design"],
  }),
  link("https://www.gutenberg.org/ebooks/1342", { tags: ["reading"] }),
  link("https://en.wikipedia.org/wiki/Bauhaus", {
    tags: ["design", "reading"],
  }),
  link("https://www.nasa.gov/image-of-the-day/", { tags: ["inspiration"] }),
  link("https://github.com/praveenjuge/teak", {
    tags: ["dev"],
    isFavorited: true,
  }),
  link("https://web.dev/articles/vitals", { tags: ["dev"] }),
  link("https://en.wikipedia.org/wiki/Tomato_soup", { tags: ["recipes"] }),
  {
    type: "quote",
    content: "Simplicity is prerequisite for reliability.",
    notes: "— Edsger W. Dijkstra",
    tags: ["engineering"],
    isFavorited: true,
  },
  {
    type: "quote",
    content: "Make it work, make it right, make it fast.",
    notes: "— Kent Beck",
    tags: ["engineering"],
  },
  {
    type: "quote",
    content: "Less, but better.",
    notes: "— Dieter Rams",
    tags: ["design"],
  },
  {
    type: "quote",
    content: "The details are not the details. They make the design.",
    notes: "— Charles Eames",
    tags: ["design"],
  },
  {
    type: "quote",
    content:
      "If you want to go fast, go alone. If you want to go far, go together.",
    notes: "— Proverb",
    tags: ["ideas"],
  },
  palette(
    "Forest walk",
    ["#2D4A3E", "#4F7A5A", "#A3B18A", "#DAD7CD", "#3A5A40"],
    { tags: ["design"], isFavorited: true }
  ),
  palette(
    "Desert dusk",
    ["#E07A5F", "#F2CC8F", "#81B29A", "#3D405B", "#F4F1DE"],
    {
      tags: ["design"],
    }
  ),
  palette(
    "Ocean deep",
    ["#03045E", "#023E8A", "#0077B6", "#00B4D8", "#90E0EF"],
    {
      tags: ["design", "inspiration"],
    }
  ),
  palette(
    "Paper and ink",
    ["#F8F9FA", "#E9ECEF", "#ADB5BD", "#495057", "#212529"],
    {
      tags: ["design"],
    }
  ),
  palette("Citrus", ["#FFBE0B", "#FB5607", "#FF006E", "#8338EC", "#3A86FF"], {
    tags: ["inspiration"],
  }),
];

export const seed = internalMutation({
  args: { workosUserId: v.string() },
  returns: v.object({
    status: v.union(v.literal("seeded"), v.literal("already_seeded")),
    cards: v.number(),
  }),
  handler: async (ctx, { workosUserId }) => {
    if (!readIsDevDeployment() && isWorkosProductionApi(workosApiBase())) {
      throw new Error(
        "devSeed runs only on the dev deployment (TEAK_DEV_DEPLOYMENT=true) or a local backend wired to the WorkOS emulator."
      );
    }
    const owner = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!owner) {
      throw new Error(
        "The dev account has no Teak owner yet; its user.created webhook has not linked it."
      );
    }
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted_created", (q) =>
        q.eq("userId", owner.teakUserId)
      )
      .take(ONBOARDING_CARDS.length + 1);
    if (cards.some((card) => !isOnboardingCard(card))) {
      return { status: "already_seeded" as const, cards: 0 };
    }
    await insertCompletedCards(ctx, owner.teakUserId, DEV_SEED_CARDS);
    return { status: "seeded" as const, cards: DEV_SEED_CARDS.length };
  },
});

const seedFolderScenario = async (
  ctx: MutationCtx,
  userId: string,
  pack: FolderScenarioPack
) => {
  const existing = await ctx.db
    .query("folders")
    .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
    .take(MAX_FOLDERS_PER_USER);
  const byKey = new Map<string, Id<"folders">>();
  for (const folder of existing) {
    if (folder.deletingAt === undefined) {
      byKey.set(folder.nameKey, folder._id);
    }
  }
  let total = existing.length;
  let created = 0;
  const now = Date.now();
  const folderIds: (Id<"folders"> | undefined)[] = [];
  for (const [index, folder] of pack.folders.entries()) {
    const key = folderNameKey(folder.name);
    let folderId = byKey.get(key);
    if (!folderId && total < MAX_FOLDERS_PER_USER) {
      folderId = await insertFolder(
        ctx,
        userId,
        folder.name.trim(),
        folder.color,
        now + index,
        folder.query === undefined
          ? undefined
          : parseSearchQuery(folder.query).canonical
      );
      byKey.set(key, folderId);
      total += 1;
      created += 1;
    }
    folderIds.push(folderId);
  }

  const marker = pack.cards[0]?.url;
  const seeded = marker
    ? await ctx.db
        .query("cards")
        .withIndex("by_user_url_deleted", (q) =>
          q.eq("userId", userId).eq("url", marker)
        )
        .first()
    : null;
  const cards: DevScenarioCardDef[] = seeded
    ? []
    : pack.cards.map(({ folders, ...card }) => ({
        ...card,
        folderIds: Array.from(
          new Set(
            folders
              .map((place) => folderIds[place])
              .filter((id): id is Id<"folders"> => id !== undefined)
          )
        ),
      }));
  if (cards.length > 0) {
    await insertCompletedCards(ctx, userId, cards, { ignoreCardLimit: true });
  }
  return {
    status:
      cards.length > 0 || created > 0
        ? ("seeded" as const)
        : ("already_seeded" as const),
    cards: cards.length,
    folders: created,
  };
};

type ScenarioPack = { description: string } & (
  | { cards: (page: number) => DevScenarioCardDef[] }
  | { folders: () => FolderScenarioPack }
  | { fillTo: number }
  | { links: CardLinkScenario }
);

const FILL_START = Date.UTC(2025, 0, 1);

const fillScenarioCards = async (
  ctx: MutationCtx,
  userId: string,
  target: number
) => {
  const active = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted_created", (q) =>
      q.eq("userId", userId).eq("isDeleted", undefined)
    )
    .take(target);
  return Array.from(
    { length: Math.max(0, target - active.length) },
    (_, index): DevScenarioCardDef => ({
      type: "text",
      content: `Filler card ${index + 1}`,
      createdAt: FILL_START + index * 60_000,
      tags: ["scenario-card-limit"],
    })
  );
};

const firstPageOnly = (cards: DevScenarioCardDef[]) => (page: number) =>
  page === 0 ? cards : [];

const SCENARIOS: Record<string, ScenarioPack> = {
  "card-details": {
    description:
      "Link bylines in every shape pages send them. Images with and without EXIF need stored files, so upload those through the API.",
    cards: () => CARD_DETAILS_SCENARIO_CARDS,
  },
  ordering: {
    description:
      "1,000 cards saved over ten years but inserted in shuffled order; each names its index and saved date. 200 per page.",
    cards: orderingScenarioPage,
  },
  "archive-mix": {
    description:
      "1,000 cards in every library state: every fifth archived, 20 of those also in Trash, 100 more only in Trash, every seventh a favorite, tags differing only by case. 200 per page.",
    cards: archiveMixScenarioPage,
  },
  "tags-2000": {
    description:
      "1,000 cards carrying 2,000 distinct tags, plus shared design, reference and inspiration tags. 200 per page.",
    cards: tags2000ScenarioPage,
  },
  "tags-case": {
    description:
      "One tag in three casings across user and AI tags on active, archived and trashed cards, beside emoji, RTL, CJK and 64-character tags.",
    cards: firstPageOnly(TAGS_CASE_SCENARIO_CARDS),
  },
  "folders-one": {
    description:
      "One folder holding active, archived and trashed cards, beside cards in no folder.",
    folders: foldersOnePack,
  },
  "folders-500": {
    description:
      "The 500-folder cap: the first holds a few cards, the rest are empty, every tenth uncolored.",
    folders: folders500Pack,
  },
  "card-in-50-folders": {
    description:
      "One card in 50 folders, one in 49, and a 51st folder neither is in, so adding the full card to it is refused.",
    folders: cardIn50FoldersPack,
  },
  "folders-ugly": {
    description:
      'Awkward folder names, one card each; case-only variants of "Ideas" share a folder, and two cards are archived or in Trash.',
    folders: foldersUglyPack,
  },
  "search-qualifiers": {
    description:
      "Links on 30 hosts written every way site: must match, tags in several casings and hex-shaped names, folders with spaces and quotes, and favorite, archived and trashed cards.",
    folders: searchQualifiersPack,
  },
  "search-qualifiers-1000": {
    description:
      "1,000 links, nine in ten on one host, so qualifiers page through more than one scan budget. 200 per page.",
    cards: searchQualifiersVolumePage,
  },
  "smart-folders": {
    description:
      "Smart folders matching nothing, the whole pack, exactly one card, a manual folder's favorites, design links, an emoji, an RTL and a 500-character search.",
    folders: smartFoldersPack,
  },
  checklists: {
    description:
      "Task lists for checklist sorting: 10 and 200 items, 5 levels of nesting, bullets beside tasks, all done, odd spacing and a table (both open as literal Markdown), and a checklist in a blockquote.",
    folders: checklistsPack,
  },
  "hidden-mix": {
    description:
      "Cards hidden by secret and hidden tags in odd case and spacing: a favorite, an archived, a trashed, a foldered and a site: one, smart folders with and without #secret, and a card whose hidden is only an AI tag. Seed it on two accounts to test ownership.",
    folders: hiddenMixPack,
  },
  "revisit-sizes": {
    description:
      "Revisit deck sizes: tags rv1, rv19, rv20 and rv21 mixing every card type (a very tall image, video, audio, a 300-character title), each with one secret card a deck must never deal; rv0 holds only that hidden card. Seed ordering too for 1,000 cards.",
    folders: revisitSizesPack,
  },
  "save-details": {
    description: `Text saved from pages (one at www.example.com, a 300-character and an RTL page title, an international host), a link with a source beside its own URL, and ${SAVE_DETAILS_SAVED_URL} already saved with tags and a note for the extension's duplicate check.`,
    folders: saveDetailsPack,
  },
  "omnibox-titles": {
    description:
      "Titles for the extension's address-bar suggestions: &, <script>, quotes, 1 < 2 > 0 in a note saved from a page, 300 characters, emoji, RTL, CJK and an empty title (shown as the host), plus a secret card that must never be suggested. Search `#scenario-omnibox-titles`; seed ordering too for many results.",
    folders: omniboxTitlesPack,
  },
  "ocr-images": {
    description: `40 images and video thumbnails with their text already read: receipts, code, memes, handwriting, Arabic, Hebrew, Japanese, Hindi, Korean and Russian signs, a 4,000-character wall of text and photos with none, plus twin notes that share a word with an image (${OCR_SHARED_KEYWORD}, "total due", Tokyo Station, fizzbuzz). Compare \`${OCR_SHARED_KEYWORD}\` with \`text:${OCR_SHARED_KEYWORD}\`.`,
    folders: ocrImagesPack,
  },
  "ocr-documents": {
    description: `Scanned PDFs with their first pages already read: a lease whose page 2 says "Lease agreement", a 300-page archive, a scan with only a "Scanned by" footer, Arabic and Chinese scans, and unread controls (a text PDF, a password-protected PDF), plus a twin note. Compare \`${OCR_LEASE_PHRASE}\` with \`text:lease\`.`,
    folders: ocrDocumentsPack,
  },
  "ocr-links": {
    description:
      'Links whose preview image and screenshot were already read: a talk\'s slide title, a docs page, a code-heavy blog post, an RTL news site, and a single-page app that rendered blank, plus a twin note. Compare `scaling postgres` with `text:"scaling postgres"`.',
    folders: ocrLinksPack,
  },
  "card-limit-199": {
    description:
      "Fills a free account's library to 199 cards, one under the free limit, so the next save is its last. Run it again after saving and it adds nothing.",
    fillTo: FREE_TIER_LIMIT - 1,
  },
  "hidden-mix-1000": {
    description:
      "The ordering pack's 1,000 cards with every fifth (200) tagged secret, for paging and Shuffle past hidden cards. 200 per page.",
    cards: hiddenMixVolumePage,
  },
  "export-ugly": {
    description:
      "Titles and folder names an export must write safely (quotes, commas, newlines, markup, formulas, emoji, RTL, CJK), a link in 50 folders, archived and favorite cards, with and without AI fields.",
    folders: exportUglyPack,
  },
  "focus-notes": {
    description:
      "Text notes for Focus mode: a 50,000-word draft, tables and code that open as literal Markdown, an empty note, CJK and RTL text, and a 300-character first line.",
    folders: focusNotesPack,
  },
  "palette-mixed": {
    description:
      "50 folders and 10 smart folders with emoji, RTL, CJK, 300-character and case-only-different names, and marker cards (one archived, one in Trash) for the command palette; seed ordering too for 1,000 cards.",
    folders: paletteMixedPack,
  },
  "keyboard-mixed": {
    description:
      "48 cards of very different heights, so arrow keys in the masonry grid must pick the visually nearest card.",
    cards: firstPageOnly(
      Array.from({ length: KEYBOARD_MIXED_SCENARIO_SIZE }, (_, index) =>
        keyboardMixedScenarioCard(index)
      )
    ),
  },
  "done-states": {
    description:
      'One link per category, every other one marked done; done links in Trash and Archive; a link with no category yet; done links with 300-character, RTL and CJK titles; and a smart folder `is:todo folder:"Reading list"`.',
    folders: doneStatesPack,
  },
  "rich-sites": {
    description:
      "Links with details from their sites: Wikipedia (English, a disambiguation page, Japanese, a missing page), arXiv (a paper with a PDF to save, an old-style id, a withdrawn paper, 300 authors), Spotify (track, album, playlist, region-locked), Apple Music, and books with an ISBN-13, an ISBN-10, none, a bad check digit and one Open Library doesn't know. Search `#scenario-rich-sites`.",
    folders: richSitesPack,
  },
  "video-captions": {
    description:
      "YouTube links with Channel, Length and Uploaded facts (a talk, a Short, a live stream with no length), and Vimeo links with transcripts as captions give them (English, unlisted, Japanese, a two-hour lecture whose line at minute 90 is searchable), a private Vimeo video with none, and a Vimeo link saved as a note. YouTube captions aren't read. Search `#scenario-video-captions`.",
    folders: videoCaptionsPack,
  },
  "podcast-transcripts": {
    description:
      "Podcast episode links with transcripts as Whisper gives them (og:audio, Apple Podcasts, an RSS-only show, a Japanese episode, one in Trash), and episodes that get none (Spotify, a 2 GB file). Search `#scenario-podcast-transcripts` or a spoken phrase such as `hermit crab`.",
    folders: podcastTranscriptsPack,
  },
  "card-links": {
    description: CARD_LINK_SCENARIO_DESCRIPTIONS["card-links"],
    links: "card-links",
  },
  backlinks: {
    description: CARD_LINK_SCENARIO_DESCRIPTIONS.backlinks,
    links: "backlinks",
  },
  "email-in": {
    description:
      "Cards as Save by email makes them, all tagged email: a newsletter with 40 tracking pixels and four kinds of redirect, a link with a sentence (a link card with a note), a subject with no body, a five-level forward chain, RTL, CJK and emoji subjects, and two links (a note). Also turns Save by email on. Search `#scenario-email-in` or `#email`.",
    folders: emailInPack,
  },
  "email-attachments": {
    description:
      "An email's body note and its attachments as their own document cards, tagged email: PDFs, two with the same name, a CJK name, a Word file and a 24 MB report. Search `#scenario-email-attachments`.",
    folders: emailAttachmentsPack,
  },
  "done-states-images": {
    description:
      "1,000 image cards and no links, so `is:todo` lists nothing. Seed it on an account without links. 200 per page.",
    cards: doneStatesImagesPage,
  },
  "shuffle-partial": {
    description:
      "400 cards, 300 without a Shuffle key as before its backfill; Shuffle must still show each card once. 200 per page.",
    cards: shufflePartialScenarioPage,
  },
};

/** Save by email on, as if an email arrived an hour ago. */
const turnOnSaveByEmail = async (ctx: MutationCtx, userId: string) => {
  const now = Date.now();
  const existing = await ctx.db
    .query("inboundEmailSettings")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (existing) {
    await ctx.db.patch("inboundEmailSettings", existing._id, {
      enabled: true,
      lastReceivedAt: now - 3_600_000,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("inboundEmailSettings", {
    createdAt: now,
    enabled: true,
    lastReceivedAt: now - 3_600_000,
    updatedAt: now,
    userId,
  });
};

const unknownScenarioMessage = () =>
  [
    "Unknown scenario. Packs:",
    ...Object.entries(SCENARIOS).map(
      ([name, { description }]) => `  ${name}: ${description}`
    ),
  ].join("\n");

export const seedScenario = internalMutation({
  args: {
    workosUserId: v.string(),
    scenario: v.string(),
    page: v.optional(v.number()),
  },
  returns: v.object({
    status: v.union(v.literal("seeded"), v.literal("already_seeded")),
    cards: v.number(),
    folders: v.optional(v.number()),
  }),
  handler: async (ctx, { workosUserId, scenario, page = 0 }) => {
    if (!readIsDevDeployment() && isWorkosProductionApi(workosApiBase())) {
      throw new Error(
        "devSeed runs only on the dev deployment (TEAK_DEV_DEPLOYMENT=true) or a local backend wired to the WorkOS emulator."
      );
    }
    const pack = new Map(Object.entries(SCENARIOS)).get(scenario);
    if (!pack) {
      throw new Error(unknownScenarioMessage());
    }
    const owner = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!owner) {
      throw new Error("No Teak owner is linked to that WorkOS user.");
    }
    if ("links" in pack) {
      return await seedCardLinkScenario(ctx, owner.teakUserId, pack.links);
    }
    if ("folders" in pack) {
      if (scenario === "email-in") {
        await turnOnSaveByEmail(ctx, owner.teakUserId);
      }
      return await seedFolderScenario(ctx, owner.teakUserId, pack.folders());
    }
    if ("fillTo" in pack) {
      const filler = await fillScenarioCards(
        ctx,
        owner.teakUserId,
        pack.fillTo
      );
      if (filler.length === 0) {
        return { status: "already_seeded" as const, cards: 0 };
      }
      await insertCompletedCards(ctx, owner.teakUserId, filler, {
        ignoreCardLimit: true,
      });
      return { status: "seeded" as const, cards: filler.length };
    }
    const cards = pack.cards(page);
    if (cards.length === 0) {
      return { status: "already_seeded" as const, cards: 0 };
    }
    const marker = cards.find((card) => card.url)?.url;
    const existing = marker
      ? await ctx.db
          .query("cards")
          .withIndex("by_user_url_deleted", (q) =>
            q.eq("userId", owner.teakUserId).eq("url", marker)
          )
          .first()
      : null;
    if (existing) {
      return { status: "already_seeded" as const, cards: 0 };
    }
    await insertCompletedCards(ctx, owner.teakUserId, cards, {
      ignoreCardLimit: true,
    });
    return { status: "seeded" as const, cards: cards.length };
  },
});

const assertPrunableDeployment = () => {
  if (!readIsDevDeployment()) {
    throw new Error(
      "Pruning cloud dev accounts runs only on the dev deployment (TEAK_DEV_DEPLOYMENT=true)."
    );
  }
};

const CLOUD_ACCOUNT_PAGE_SIZE = 100;

export const listCloudAccounts = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    accounts: v.array(
      v.object({ email: v.string(), workosUserId: v.string() })
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    assertPrunableDeployment();
    const page = await ctx.db
      .query("users")
      .withIndex("by_email", (q) =>
        q
          .gte("email", CLOUD_DEV_ACCOUNT_EMAIL_RANGE.start)
          .lt("email", CLOUD_DEV_ACCOUNT_EMAIL_RANGE.end)
      )
      .paginate({ numItems: CLOUD_ACCOUNT_PAGE_SIZE, cursor });
    const accounts: { email: string; workosUserId: string }[] = [];
    for (const owner of page.page) {
      if (
        owner.deletedAt !== undefined ||
        !owner.workosUserId ||
        !CLOUD_DEV_ACCOUNT_EMAIL.test(owner.email) ||
        (await getAccountDeletionState(ctx, owner.teakUserId))
      ) {
        continue;
      }
      accounts.push({ email: owner.email, workosUserId: owner.workosUserId });
    }
    return {
      accounts,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const pruneCloudAccount = internalMutation({
  args: { workosUserId: v.string() },
  returns: v.union(v.literal("deleting"), v.literal("already_deleted")),
  handler: async (ctx, { workosUserId }) => {
    assertPrunableDeployment();
    const owner = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!owner) {
      throw new Error("No Teak owner is linked to that WorkOS user.");
    }
    if (!CLOUD_DEV_ACCOUNT_EMAIL.test(owner.email)) {
      throw new Error(
        "Only cloud session dev accounts (dev+cloud-<hash>-<checkout>@example.org) can be pruned."
      );
    }
    if (owner.deletedAt !== undefined) {
      return "already_deleted" as const;
    }
    await initiateAccountDeletion(ctx, owner);
    return "deleting" as const;
  },
});
