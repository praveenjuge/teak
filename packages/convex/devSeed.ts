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
  type DefaultCardDef,
  insertCompletedCards,
  isOnboardingCard,
  ONBOARDING_CARDS,
} from "./card/defaultCards";
import { readIsDevDeployment } from "./env";
import { insertFolder } from "./folder/folders";
import {
  CLOUD_DEV_ACCOUNT_EMAIL,
  CLOUD_DEV_ACCOUNT_EMAIL_RANGE,
} from "./shared/devAccounts";
import {
  type FolderColor,
  folderNameKey,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "./shared/folders";
import { parseSearchQuery } from "./shared/search/qualifiers";
import { isWorkosProductionApi, workosApiBase } from "./shared/workosApi";

const link = (
  url: string,
  extra: Partial<DefaultCardDef> = {}
): DefaultCardDef => ({
  type: "link",
  content: url,
  url,
  runProcessing: true,
  ...extra,
});

const palette = (
  content: string,
  hexes: string[],
  extra: Partial<DefaultCardDef> = {}
): DefaultCardDef => ({
  type: "palette",
  content,
  colors: hexes.map((hex) => ({ hex })),
  ...extra,
});

export const DEV_SEED_CARDS: DefaultCardDef[] = [
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
      .withIndex("by_user_deleted", (q) => q.eq("userId", owner.teakUserId))
      .take(ONBOARDING_CARDS.length + 1);
    if (cards.some((card) => !isOnboardingCard(card))) {
      return { status: "already_seeded" as const, cards: 0 };
    }
    await insertCompletedCards(ctx, owner.teakUserId, DEV_SEED_CARDS);
    return { status: "seeded" as const, cards: DEV_SEED_CARDS.length };
  },
});

// Opt-in scenario packs for checking a feature against awkward data. Unlike
// `seed`, they add to a vault that already holds cards, and run only when
// asked: `bunx convex run devSeed:seedScenario '{"workosUserId": "...",
// "scenario": "card-details"}'`. Each pack's cards carry a marker URL, so
// running a pack twice adds nothing the second time.

const SCENARIO_MARKER = "teak-scenario";

const bylineLink = (
  slug: string,
  url: string,
  linkPreview: Record<string, unknown>,
  extra: Partial<DefaultCardDef> = {}
): DefaultCardDef => {
  const markedUrl = `${url}#${SCENARIO_MARKER}-card-details-${slug}`;
  return {
    type: "link",
    content: markedUrl,
    url: markedUrl,
    tags: ["scenario-card-details"],
    metadataTitle:
      typeof linkPreview.title === "string" ? linkPreview.title : undefined,
    metadata: {
      linkPreview: {
        source: "scenario",
        status: "success",
        fetchedAt: Date.UTC(2026, 9, 1),
        url: markedUrl,
        finalUrl: markedUrl,
        ...linkPreview,
      } as never,
    },
    ...extra,
  };
};

// Phase 1 ("card details"): link bylines in every shape pages send them.
// Images with and without EXIF need stored files, so they are uploaded
// through the API instead (see the Phase 1 plan's proof steps).
export const CARD_DETAILS_SCENARIO_CARDS: DefaultCardDef[] = [
  bylineLink("full", "https://www.theverge.com/2024/3/5/teak-byline", {
    title: "A full byline whose publisher repeats the site",
    description: "Author, publisher and date; the publisher names the host.",
    author: "Nilay Patel",
    publisher: "The Verge",
    publishedAt: "2024-03-05T10:00:00Z",
  }),
  bylineLink("publisher", "https://www.nytimes.com/2023/11/20/teak.html", {
    title: "Author, a distinct publisher and a date",
    author: "Jane Doe",
    publisher: "The New York Times",
    publishedAt: "2023-11-20",
  }),
  bylineLink("author-only", "https://paulgraham.com/teak.html", {
    title: "Only an author, who is also the publisher",
    author: "Paul Graham",
    publisher: "paul graham",
  }),
  bylineLink("date-only", "https://blog.example.com/teak-date-only", {
    title: "Only a publish date with a time zone offset",
    publishedAt: "2025-12-31T23:30:00-05:00",
  }),
  bylineLink("garbage", "https://medium.com/@someone/teak-garbage", {
    title: "An author that is a profile URL and a garbage date",
    author: "https://www.facebook.com/someauthor",
    publishedAt: "sometime last week",
  }),
  bylineLink("long", "https://longreads.example.org/teak-long", {
    title:
      "A very long byline that must truncate in the preview without breaking the layout of the card modal at any width",
    author: `Dr. ${"Bartholomew Montgomery-Fitzgerald ".repeat(8).trim()}`,
    publisher: `The ${"Extraordinarily Verbose ".repeat(6).trim()} Quarterly`,
    publishedAt: "2022-06-01",
  }),
  bylineLink("rtl-cjk", "https://www.aljazeera.net/teak-rtl", {
    title: "مقال عن الأفكار — 東京のアイデア",
    author: "山田太郎",
    publisher: "مجلة العربي",
    publishedAt: "2021-02-14",
  }),
  bylineLink("unicode-host", "https://bücher.example/teak-unicode", {
    title: "A unicode host with an umlaut author",
    author: "Jürgen Müller",
    publishedAt: "2020-07-04",
  }),
  bylineLink(
    "no-metadata",
    "https://unreachable.example.net/teak-none",
    { status: "error" },
    { metadataTitle: "A link whose preview failed" }
  ),
  bylineLink(
    "trashed",
    "https://www.theguardian.com/teak-trashed",
    {
      title: "A trashed link with a byline",
      author: "Ada Lovelace",
      publisher: "The Guardian",
      publishedAt: "2019-10-10",
    },
    { isDeleted: true }
  ),
];

// Ordering: 1,000 cards whose saved dates (`createdAt`) are spread over ten
// years but inserted in a shuffled order, so insertion order and saved date
// disagree on every page. Each card's text names its index and saved date,
// so the grid shows at a glance whether it is sorted. Seeded 200 at a time.
export const ORDERING_SCENARIO_SIZE = 1000;
export const ORDERING_SCENARIO_PAGE_SIZE = 200;
const ORDERING_START = Date.UTC(2016, 0, 1);
const ORDERING_SPAN = Date.UTC(2026, 0, 1) - ORDERING_START;
const ORDERING_TYPES = ["text", "quote", "link", "palette"] as const;

const orderingIndexAt = (position: number) =>
  (position * 389) % ORDERING_SCENARIO_SIZE;

const orderingHex = (seed: number) =>
  `#${(Math.floor(((seed + 1) * 2_654_435_761) / 256) % 0x1_00_00_00)
    .toString(16)
    .padStart(6, "0")}`;

export const orderingScenarioCard = (position: number): DefaultCardDef => {
  const index = orderingIndexAt(position);
  const createdAt =
    ORDERING_START +
    Math.floor((index / ORDERING_SCENARIO_SIZE) * ORDERING_SPAN);
  const label = `#${String(index).padStart(4, "0")} saved ${new Date(createdAt).toISOString().slice(0, 10)}`;
  const type = ORDERING_TYPES[index % ORDERING_TYPES.length];
  const base = {
    createdAt,
    tags: ["scenario-ordering"],
    isFavorited: index % 7 === 0 || undefined,
    isDeleted: index % 50 === 0 || undefined,
  };
  if (type === "link") {
    const url = `https://example.com/ordering/${index}#${SCENARIO_MARKER}-ordering`;
    return {
      ...base,
      type,
      content: url,
      url,
      metadataTitle: `Link ${label}`,
    };
  }
  if (type === "palette") {
    return {
      ...base,
      ...palette(`Palette ${label}`, [
        orderingHex(index),
        orderingHex(index + 500),
      ]),
    };
  }
  return {
    ...base,
    type,
    content: type === "quote" ? `"Quote ${label}"` : `Note ${label}`,
  };
};

const orderingScenarioPage = (page: number): DefaultCardDef[] => {
  const start = page * ORDERING_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ORDERING_SCENARIO_PAGE_SIZE,
    ORDERING_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    orderingScenarioCard(start + offset)
  );
};

// Archive mix: 1,000 cards in every library state. Every fifth card is
// archived (200), 20 of those are also in Trash, 100 more are only in Trash,
// and every seventh card is a favorite whatever its state. Tags differ only
// by case ("Moodboard", "moodboard") across archived and active cards. Each
// label names its state, so a wrong view shows at a glance. Seeded 200 at a
// time.
export const ARCHIVE_MIX_SCENARIO_SIZE = 1000;
export const ARCHIVE_MIX_SCENARIO_PAGE_SIZE = 200;
const ARCHIVE_MIX_START = Date.UTC(2025, 0, 1);

export const archiveMixScenarioCard = (index: number): DefaultCardDef => {
  const isArchived = index % 5 === 0;
  const isDeleted = index % 10 === 3 || index % 50 === 0;
  const isFavorited = index % 7 === 0;
  let state = "active";
  if (isArchived && isDeleted) {
    state = "archived, in Trash";
  } else if (isArchived) {
    state = "archived";
  } else if (isDeleted) {
    state = "in Trash";
  }
  const label = `Mix #${String(index).padStart(4, "0")} ${state}${isFavorited ? ", favorite" : ""}`;
  const base = {
    createdAt: ARCHIVE_MIX_START + index * 3_600_000,
    tags: ["scenario-archive", index % 2 === 0 ? "Moodboard" : "moodboard"],
    isArchived: isArchived || undefined,
    isDeleted: isDeleted || undefined,
    isFavorited: isFavorited || undefined,
  };
  const type = ORDERING_TYPES[index % ORDERING_TYPES.length];
  if (type === "link") {
    const url = `https://example.com/archive-mix/${index}#${SCENARIO_MARKER}-archive`;
    return { ...base, type, content: url, url, metadataTitle: label };
  }
  if (type === "palette") {
    return {
      ...base,
      ...palette(label, [orderingHex(index), orderingHex(index + 500)]),
    };
  }
  return {
    ...base,
    type,
    content: type === "quote" ? `"${label}"` : label,
  };
};

const archiveMixScenarioPage = (page: number): DefaultCardDef[] => {
  const start = page * ARCHIVE_MIX_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ARCHIVE_MIX_SCENARIO_PAGE_SIZE,
    ARCHIVE_MIX_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    archiveMixScenarioCard(start + offset)
  );
};

// Tag packs (Phase 6). "tags-2000": 1,000 cards carrying 2,000 distinct tags
// (two each), plus a few shared ones so the sidebar has clear leaders: every
// other card is "design", every third "reference", every fifth
// "inspiration". Seeded 200 cards at a time.
export const TAGS_2000_SCENARIO_SIZE = 1000;
export const TAGS_2000_SCENARIO_PAGE_SIZE = 200;
const TAGS_2000_START = Date.UTC(2025, 6, 1);

export const tags2000ScenarioCard = (index: number): DefaultCardDef => {
  const topic = (n: number) => `topic-${String(n).padStart(4, "0")}`;
  const tags = [topic(index * 2), topic(index * 2 + 1)];
  if (index % 2 === 0) {
    tags.push("design");
  }
  if (index % 3 === 0) {
    tags.push("reference");
  }
  if (index % 5 === 0) {
    tags.push("inspiration");
  }
  const label = `Tagged #${String(index).padStart(4, "0")}`;
  const base = { createdAt: TAGS_2000_START + index * 3_600_000, tags };
  if (index % 4 === 0) {
    const url = `https://example.com/tags-2000/${index}#${SCENARIO_MARKER}-tags-2000`;
    return { ...base, type: "link", content: url, url, metadataTitle: label };
  }
  return { ...base, type: "text", content: label };
};

const tags2000ScenarioPage = (page: number): DefaultCardDef[] => {
  const start = page * TAGS_2000_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + TAGS_2000_SCENARIO_PAGE_SIZE,
    TAGS_2000_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    tags2000ScenarioCard(start + offset)
  );
};

// "tags-case": one tag in three casings across user and AI tags, on active,
// archived and trashed cards, next to emoji, right-to-left, CJK and
// 64-character tags.
export const LONG_SCENARIO_TAG = `long-${"x".repeat(59)}`;

const tagsCaseCard = (
  slug: string,
  label: string,
  extra: Partial<DefaultCardDef>
): DefaultCardDef => {
  const url = `https://example.com/tags-case/${slug}#${SCENARIO_MARKER}-tags-case`;
  return {
    type: "link",
    content: url,
    url,
    metadataTitle: label,
    ...extra,
  };
};

export const TAGS_CASE_SCENARIO_CARDS: DefaultCardDef[] = [
  tagsCaseCard("upper-first", "Design (user tag)", { tags: ["Design", "web"] }),
  tagsCaseCard("lower", "design (user tag)", { tags: ["design", "ui"] }),
  tagsCaseCard("caps", "DESIGN (user tag)", { tags: ["DESIGN"] }),
  tagsCaseCard("ai", "design (AI tag)", { aiTags: ["design", "Moodboard"] }),
  tagsCaseCard("both", "Design user + design AI", {
    tags: ["Design"],
    aiTags: ["design"],
  }),
  tagsCaseCard("archived", "Design, archived", {
    tags: ["Design"],
    isArchived: true,
  }),
  tagsCaseCard("trashed", "DESIGN, in Trash", {
    tags: ["DESIGN"],
    isDeleted: true,
  }),
  tagsCaseCard("emoji", "Emoji tags", { tags: ["🎨 art", "✨"] }),
  tagsCaseCard("rtl", "Right-to-left tag", { tags: ["تصميم", "עיצוב"] }),
  tagsCaseCard("cjk", "CJK tags", { tags: ["设计", "デザイン", "디자인"] }),
  tagsCaseCard("long", "64-character tag", { tags: [LONG_SCENARIO_TAG] }),
];

// Folder packs. Each lists its folders and its cards, and each card names
// the folders it starts in by their place in that list. Folders are matched
// by name ignoring case, as the app matches them: running a pack twice adds
// nothing, and a name that differs from another only by case lands in the
// same folder rather than breaking the one-name-per-folder rule. Folders stop
// at the account's cap. The cards' marker URL makes them seed once.
export interface FolderScenarioCard extends Omit<DefaultCardDef, "folderIds"> {
  folders: number[];
}

export interface FolderScenarioPack {
  cards: FolderScenarioCard[];
  folders: { color?: FolderColor; name: string; query?: string }[];
}

export const FOLDER_SCENARIOS = [
  "folders-one",
  "folders-500",
  "card-in-50-folders",
  "folders-ugly",
  "search-qualifiers",
  "smart-folders",
  "export-ugly",
] as const;
export type FolderScenario = (typeof FOLDER_SCENARIOS)[number];

const FOLDER_SCENARIO_START = Date.UTC(2026, 8, 1);

const folderScenarioCard = (
  scenario: FolderScenario,
  index: number,
  label: string,
  folders: number[],
  extra: Partial<DefaultCardDef> = {}
): FolderScenarioCard => {
  const base = {
    createdAt: FOLDER_SCENARIO_START + index * 3_600_000,
    tags: [`scenario-${scenario}`],
    folders,
    ...extra,
  };
  if (index === 0) {
    const url = `https://example.com/${scenario}#${SCENARIO_MARKER}-${scenario}`;
    return { ...base, type: "link", content: url, url, metadataTitle: label };
  }
  return { ...base, type: "text", content: label };
};

const FOLDER_COLOR_CYCLE: (FolderColor | undefined)[] = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  undefined,
];

// One folder holding active, archived and trashed cards, beside cards that
// are in no folder, so the folder view and its count show what they leave
// out.
const foldersOnePack = (): FolderScenarioPack => {
  const states: [string, Partial<DefaultCardDef>][] = [
    ...Array.from({ length: 8 }, (): [string, Partial<DefaultCardDef>] => [
      "active",
      {},
    ]),
    ["archived", { isArchived: true }],
    ["archived", { isArchived: true }],
    ["in Trash", { isDeleted: true }],
    ["archived, in Trash", { isArchived: true, isDeleted: true }],
  ];
  const inFolder = states.map(([state, extra], index) =>
    folderScenarioCard(
      "folders-one",
      index,
      `In the folder #${String(index + 1).padStart(2, "0")}, ${state}`,
      [0],
      extra
    )
  );
  const outside = [0, 1, 2].map((offset) =>
    folderScenarioCard(
      "folders-one",
      states.length + offset,
      `In no folder #${offset + 1}`,
      []
    )
  );
  return {
    folders: [{ name: "Scenario folder", color: "teal" }],
    cards: [...inFolder, ...outside],
  };
};

// The account's cap: 500 folders, the first holding a few cards, the rest
// empty, every tenth one uncolored.
const folders500Pack = (): FolderScenarioPack => ({
  folders: Array.from({ length: MAX_FOLDERS_PER_USER }, (_, index) => ({
    name: `Folder ${String(index + 1).padStart(3, "0")}`,
    color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
  })),
  cards: [0, 1, 2].map((index) =>
    folderScenarioCard(
      "folders-500",
      index,
      `In Folder 001 and Folder ${String(500 - index).padStart(3, "0")}`,
      [0, 499 - index]
    )
  ),
});

// A card at the per-card cap: one card in 50 folders, one in 49, and a 51st
// folder neither is in, so adding the full card to it is refused.
const cardIn50FoldersPack = (): FolderScenarioPack => {
  const all = Array.from({ length: MAX_FOLDERS_PER_CARD }, (_, index) => index);
  return {
    folders: Array.from({ length: MAX_FOLDERS_PER_CARD + 1 }, (_, index) => ({
      name: `Stack ${String(index + 1).padStart(2, "0")}`,
      color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
    })),
    cards: [
      folderScenarioCard(
        "card-in-50-folders",
        0,
        `In ${MAX_FOLDERS_PER_CARD} folders, the most a card can be in`,
        all
      ),
      folderScenarioCard(
        "card-in-50-folders",
        1,
        `In ${MAX_FOLDERS_PER_CARD - 1} folders, one short of the cap`,
        all.slice(0, -1)
      ),
    ],
  };
};

const longName = (word: string) =>
  `${word} `.repeat(MAX_FOLDER_NAME_LENGTH).slice(0, MAX_FOLDER_NAME_LENGTH);

export const UGLY_FOLDER_NAMES = [
  "🎨 Moodboard ✨",
  "👩‍👩‍👧‍👦",
  "مجلد الأفكار",
  "רשימת קריאה",
  "東京のアイデア",
  "읽을 거리",
  "Ideas",
  "IDEAS",
  "ideas",
  longName("Longest"),
  "📚".repeat(MAX_FOLDER_NAME_LENGTH),
  "Two  spaces   inside",
  "<b>Not bold</b> & “quoted”",
  "Zürich",
];

const UGLY_CARD_STATES: Record<number, Partial<DefaultCardDef>> = {
  2: { isArchived: true },
  3: { isDeleted: true },
};

// Awkward names, each folder holding one card; the case-only variants of
// "Ideas" land in the same folder, and two cards are archived or in Trash.
const foldersUglyPack = (): FolderScenarioPack => ({
  folders: UGLY_FOLDER_NAMES.map((name, index) => ({
    name,
    color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
  })),
  cards: UGLY_FOLDER_NAMES.map((name, index) =>
    folderScenarioCard(
      "folders-ugly",
      index,
      `In “${Array.from(name).slice(0, 40).join("")}”`,
      [index],
      UGLY_CARD_STATES[index]
    )
  ),
});

// "search-qualifiers": links on 30 hosts written every way `site:` must
// match (www., capitals, a port, Unicode and punycode, an IP), tags in
// several casings and hex-shaped names (`#fff` is a color, `tag:fff` the
// tag), folders with spaces and quotes, and favorite, archived and trashed
// cards among them.
export const SEARCH_QUALIFIER_HOSTS = [
  "https://github.com/teak/design-system",
  "https://www.github.com/teak/notes",
  "https://GitHub.com/teak/upper",
  "https://gist.github.com/teak/snippet",
  "https://www.example.com/page",
  "https://blog.example.com/post",
  "https://news.ycombinator.com/item",
  "https://dribbble.com/shots/1",
  "https://www.figma.com/file/a",
  "https://figma.com/community/b",
  "https://medium.com/@teak/design",
  "https://dev.to/teak/post",
  "https://stackoverflow.com/q/1",
  "https://www.youtube.com/watch?v=1",
  "https://m.youtube.com/watch?v=2",
  "https://vimeo.com/1",
  "https://arxiv.org/abs/1",
  "https://en.wikipedia.org/wiki/Design",
  "https://例え.jp/ページ",
  "https://xn--r8jz45g.jp/punycode",
  "https://bücher.example/buch",
  "http://192.168.1.20:8080/router",
  "http://localhost:3000/dev",
  "https://www.notion.so/page",
  "https://linear.app/teak/issue",
  "https://vercel.com/docs",
  "https://tailwindcss.com/docs",
  "https://www.reddit.com/r/design",
  "https://old.reddit.com/r/web",
  "https://example.com./trailing-dot",
] as const;

const SEARCH_QUALIFIER_TAGS = [
  ["Design"],
  ["design", "Systems"],
  ["DESIGN", "web design"],
  ["fff"],
  ["bad", "design"],
  ["Design Systems"],
  [],
] as const;

const SEARCH_QUALIFIER_TEXTS = [
  "A design system primer",
  "System design interview notes",
  "“Design system” with smart quotes",
  "Colour #fff swatches and the tag fff",
  'Notes that say "hi" in quotes',
  "Reading about design, systems and more",
] as const;

const searchQualifiersPack = (): FolderScenarioPack => {
  const scenario = "search-qualifiers" as const;
  const extraFor = (index: number): Partial<DefaultCardDef> => ({
    tags: [
      `scenario-${scenario}`,
      ...SEARCH_QUALIFIER_TAGS[index % SEARCH_QUALIFIER_TAGS.length],
    ],
    ...(index % 5 === 2 ? { isFavorited: true } : {}),
    ...(index % 7 === 3 ? { isArchived: true } : {}),
    ...(index % 11 === 9 ? { isDeleted: true } : {}),
  });
  const links = SEARCH_QUALIFIER_HOSTS.map((url, offset) => {
    const index = offset + 1;
    const card = folderScenarioCard(scenario, index, "", [], extraFor(index));
    const markedUrl = `${url}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...card,
      type: "link" as const,
      content: markedUrl,
      url: markedUrl,
      metadataTitle: `${index % 2 === 0 ? "Design system" : "Notes"} on ${new URL(url).host}`,
      folders: [index % 4, (index + 1) % 5].filter((place) => place < 4),
    };
  });
  const texts = SEARCH_QUALIFIER_TEXTS.map((text, offset) => {
    const index = SEARCH_QUALIFIER_HOSTS.length + 1 + offset;
    return folderScenarioCard(scenario, index, text, [offset % 4], {
      tags: [
        `scenario-${scenario}`,
        ...SEARCH_QUALIFIER_TAGS[offset % SEARCH_QUALIFIER_TAGS.length],
      ],
    });
  });
  return {
    folders: [
      { name: "Reading list", color: "blue" },
      { name: 'Say "hi"', color: "amber" },
      { name: "Design refs", color: "violet" },
      { name: "Ideas & things", color: "green" },
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Search qualifiers pack", [0]),
      ...links,
      ...texts,
    ],
  };
};

// "smart-folders": smart folders whose searches match nothing, the whole
// pack, exactly one card, a manual folder's favorites (`folder:`), design
// links, an emoji and an RTL search, and a search at the 500-character
// limit, over a handful of cards that exercise each.
const SMART_FOLDER_PHRASE = "the only card with this phrase";
const smartFolderLongQuery = () => {
  const head = "tag:scenario-smart-folders";
  const filler = Array.from({ length: 200 }, (_, index) => `w${index}`).join(
    " "
  );
  return `${head} ${filler}`.slice(0, MAX_SMART_FOLDER_QUERY_LENGTH).trim();
};

const smartFoldersPack = (): FolderScenarioPack => {
  const scenario = "smart-folders" as const;
  const tagged = (...tags: string[]) => ({
    tags: [`scenario-${scenario}`, ...tags],
  });
  const designLink = (index: number, host: string, title: string) => {
    const url = `https://${host}/${index}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", [], tagged("design")),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
    };
  };
  return {
    folders: [
      { name: "Reading list", color: "blue" },
      {
        name: "Nothing matches",
        query: `tag:scenario-${scenario} tag:no-such-tag`,
      },
      {
        name: "Everything in the pack",
        color: "gray",
        query: `tag:scenario-${scenario}`,
      },
      {
        name: "Just one card",
        color: "amber",
        query: `"${SMART_FOLDER_PHRASE}"`,
      },
      {
        name: "Favorite reading",
        color: "pink",
        query: 'folder:"Reading list" is:fav',
      },
      { name: "Design links", color: "violet", query: "tag:design type:link" },
      // An emoji tag, not an emoji word: full-text search skips emoji.
      { name: "🎨 Moodboard ✨", color: "orange", query: "#design tag:🎨" },
      { name: "مجلد ذكي للتصميم", color: "teal", query: '"تصميم"' },
      { name: "Five hundred characters", query: smartFolderLongQuery() },
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Smart folders pack", [0], tagged()),
      designLink(1, "dribbble.com/shots", "Design link on Dribbble"),
      designLink(2, "www.figma.com/file", "Design link on Figma"),
      folderScenarioCard(scenario, 3, "A favorite to read", [0], {
        ...tagged(),
        isFavorited: true,
      }),
      folderScenarioCard(
        scenario,
        4,
        "Read later, not a favorite",
        [0],
        tagged()
      ),
      folderScenarioCard(
        scenario,
        5,
        `This is ${SMART_FOLDER_PHRASE}.`,
        [],
        tagged()
      ),
      folderScenarioCard(
        scenario,
        6,
        "🎨 Palette ideas",
        [],
        tagged("design", "🎨")
      ),
      folderScenarioCard(
        scenario,
        7,
        "ملاحظات حول تصميم الواجهات",
        [],
        tagged()
      ),
      folderScenarioCard(scenario, 8, "Archived design note", [], {
        ...tagged("design"),
        isArchived: true,
      }),
    ],
  };
};

export const EXPORT_UGLY_FOLDER_NAMES = [
  'Quotes "and", commas',
  "Line one\nline two",
  "<script>alert(1)</script>",
  '=HYPERLINK("https://example.com","Click")',
  "🎨 Moodboard 😀",
  "مجلد الأفكار",
  "東京のアイデア",
  longName("Folder"),
];

// "export-ugly": what an export must write safely in cards.json,
// bookmarks.html and cards.csv: titles and folder names with quotes, commas,
// newlines, markup, formulas, emoji, RTL and CJK; a link in 50 folders;
// archived and favorite cards; cards with and without AI fields.
const exportUglyPack = (): FolderScenarioPack => {
  const scenario = "export-ugly" as const;
  const stacks = Array.from(
    { length: MAX_FOLDERS_PER_CARD },
    (_, index) => EXPORT_UGLY_FOLDER_NAMES.length + index
  );
  const ai = (summary: string, ...aiTags: string[]) => ({
    aiSummary: summary,
    aiTags,
  });
  const link = (
    index: number,
    title: string,
    folders: number[],
    extra: Partial<DefaultCardDef> = {}
  ) => {
    const url = `https://example.com/export-ugly/${index}?a=1&b="2"`;
    return {
      ...folderScenarioCard(scenario, index, "", folders, extra),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
    };
  };
  return {
    folders: [
      ...EXPORT_UGLY_FOLDER_NAMES.map((name, index) => ({
        name,
        color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
      })),
      ...stacks.map((_, index) => ({
        name: `Export stack ${String(index + 1).padStart(2, "0")}`,
      })),
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Export ugly pack", [0]),
      link(1, 'He said "hi", then left, quickly', [0, 1], {
        isFavorited: true,
        tags: [`scenario-${scenario}`, "a,b", "=SUM(1+1)"],
        ...ai('A summary, with a comma and "quotes".', "quotes", "commas"),
      }),
      link(2, '<script>alert("x")</script> & <b>bold</b>', [2], {
        isArchived: true,
        ...ai("<img src=x onerror=alert(1)>", "markup"),
      }),
      link(3, '=HYPERLINK("https://evil.example","Click me")', [3], {
        notes: "+1 for this\n-1 for that\n@someone",
      }),
      folderScenarioCard(
        scenario,
        4,
        'Line one\nLine two, with "quotes"\r\nLine three',
        [1],
        ai("-starts with a minus", "newlines")
      ),
      link(5, "🎨 مرحبا 東京 שלום 👩‍👩‍👧", [4, 5, 6], ai("多言語", "unicode")),
      link(6, longName("Title"), [7]),
      link(7, "In 50 folders", stacks, ai("A link in every stack", "stacks")),
      link(8, "Archived favorite, no AI", [], {
        isArchived: true,
        isFavorited: true,
      }),
      folderScenarioCard(scenario, 9, "@mention at the start", []),
      {
        ...folderScenarioCard(
          scenario,
          10,
          "+plus at the start",
          [],
          ai("A quote", "quote")
        ),
        type: "quote" as const,
      },
      folderScenarioCard(scenario, 11, "In Trash, left out of exports", [0], {
        isDeleted: true,
      }),
    ],
  };
};

export const folderScenarioPack = (
  scenario: FolderScenario
): FolderScenarioPack => {
  switch (scenario) {
    case "search-qualifiers":
      return searchQualifiersPack();
    case "smart-folders":
      return smartFoldersPack();
    case "export-ugly":
      return exportUglyPack();
    case "folders-one":
      return foldersOnePack();
    case "folders-500":
      return folders500Pack();
    case "card-in-50-folders":
      return cardIn50FoldersPack();
    default:
      return foldersUglyPack();
  }
};

const isFolderScenario = (scenario: string): scenario is FolderScenario =>
  (FOLDER_SCENARIOS as readonly string[]).includes(scenario);

const seedFolderScenario = async (
  ctx: MutationCtx,
  userId: string,
  scenario: FolderScenario
) => {
  const pack = folderScenarioPack(scenario);
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
  const cards: DefaultCardDef[] = seeded
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

// "search-qualifiers-1000": 1,000 links, nine in ten on one host, so `site:`
// and the other qualifiers page through more than one scan budget. Seeded
// 200 at a time.
export const SEARCH_QUALIFIERS_VOLUME_SIZE = 1000;
export const SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE = 200;
const SEARCH_QUALIFIERS_VOLUME_START = Date.UTC(2024, 0, 1);
const VOLUME_RARE_HOSTS = [
  "github.com",
  "www.figma.com",
  "例え.jp",
  "blog.example.com",
] as const;

export const searchQualifiersVolumeCard = (index: number): DefaultCardDef => {
  const host =
    index % 10 === 0
      ? VOLUME_RARE_HOSTS[(index / 10) % VOLUME_RARE_HOSTS.length]
      : "noise.example";
  const url = `https://${host}/volume/${index}#${SCENARIO_MARKER}-search-qualifiers-1000`;
  return {
    type: "link",
    content: url,
    url,
    metadataTitle: `Volume #${String(index).padStart(4, "0")} on ${host}`,
    createdAt: SEARCH_QUALIFIERS_VOLUME_START + index * 3_600_000,
    tags: [
      "scenario-search-qualifiers-1000",
      ...(index % 3 === 0 ? ["design"] : []),
    ],
    ...(index % 9 === 0 ? { isFavorited: true } : {}),
    ...(index % 13 === 0 ? { isArchived: true } : {}),
  };
};

const searchQualifiersVolumePage = (page: number): DefaultCardDef[] => {
  const start = page * SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE;
  const end = Math.min(
    start + SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE,
    SEARCH_QUALIFIERS_VOLUME_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    searchQualifiersVolumeCard(start + offset)
  );
};

// "keyboard-mixed": 48 cards whose heights differ a lot (tall and wide
// blocks beside one-line notes and palettes), so moving through the masonry
// grid with the arrow keys has to pick the visually nearest card. The blocks
// are images with no stored file: the grid shows them in their color at
// their size.
const KEYBOARD_MIXED_START = Date.UTC(2026, 9, 1);
const KEYBOARD_MIXED_SHAPES = [
  "tall",
  "palette",
  "short",
  "wide",
  "quote",
  "link",
  "very tall",
  "short",
] as const;
const KEYBOARD_MIXED_COLORS = [
  "#1f6feb",
  "#d97706",
  "#059669",
  "#be185d",
  "#7c3aed",
  "#0f766e",
];

export const keyboardMixedScenarioCard = (index: number): DefaultCardDef => {
  const shape = KEYBOARD_MIXED_SHAPES[index % KEYBOARD_MIXED_SHAPES.length];
  const label = `Keyboard mix #${String(index).padStart(2, "0")} ${shape}`;
  const color =
    KEYBOARD_MIXED_COLORS[index % KEYBOARD_MIXED_COLORS.length] ?? "#1f6feb";
  const base = {
    createdAt: KEYBOARD_MIXED_START + index * 60_000,
    tags: ["scenario-keyboard-mixed"],
  };
  const block = (width: number, height: number): DefaultCardDef => ({
    ...base,
    type: "image",
    content: label,
    colors: [{ hex: color }],
    fileMetadata: {
      fileName: `keyboard-mix-${String(index).padStart(2, "0")}.png`,
      fileSize: 0,
      mimeType: "image/png",
      width,
      height,
    },
  });
  switch (shape) {
    case "tall":
      return block(600, 1200);
    case "very tall":
      return block(400, 1400);
    case "wide":
      return block(1600, 600);
    case "palette":
      return { ...base, ...palette(label, [color, "#f5f5f4", "#1c1917"]) };
    case "quote":
      return { ...base, type: "quote", content: `"${label}"` };
    case "link": {
      const url = `https://example.com/keyboard-mixed/${index}#${SCENARIO_MARKER}-keyboard-mixed-${index}`;
      return { ...base, type: "link", content: url, url, metadataTitle: label };
    }
    default:
      return { ...base, type: "text", content: label };
  }
};

const KEYBOARD_MIXED_SCENARIO_SIZE = 48;

// "shuffle-partial": 400 cards, 300 of them without a Shuffle key, as cards
// saved before the key existed are until the backfill runs. Every fourth
// card has a key. Shuffle must still show each card exactly once. Seeded 200
// at a time; each page starts with its marker link.
export const SHUFFLE_PARTIAL_SCENARIO_SIZE = 400;
const SHUFFLE_PARTIAL_PAGE_SIZE = 200;
const SHUFFLE_PARTIAL_START = Date.UTC(2024, 0, 1);
const SHUFFLE_PARTIAL_TYPES = ["text", "quote", "palette"] as const;

export const shufflePartialScenarioCard = (index: number): DefaultCardDef => {
  const keyed = index % 4 === 0;
  const label = `Shuffle #${String(index).padStart(3, "0")} ${
    keyed ? "keyed" : "no key"
  }`;
  const base = {
    createdAt: SHUFFLE_PARTIAL_START + index * 86_400_000,
    tags: ["scenario-shuffle-partial"],
    shuffleKey: keyed ? undefined : null,
  };
  if (index % SHUFFLE_PARTIAL_PAGE_SIZE === 0) {
    const url = `https://example.com/shuffle-partial/${index}#${SCENARIO_MARKER}-shuffle-partial-${index}`;
    return { ...base, type: "link", content: url, url, metadataTitle: label };
  }
  const type = SHUFFLE_PARTIAL_TYPES[index % SHUFFLE_PARTIAL_TYPES.length];
  if (type === "palette") {
    return { ...base, ...palette(label, ["#0f766e", "#f5f5f4", "#1c1917"]) };
  }
  return {
    ...base,
    type,
    content: type === "quote" ? `"${label}"` : label,
  };
};

const shufflePartialScenarioPage = (page: number): DefaultCardDef[] => {
  const start = page * SHUFFLE_PARTIAL_PAGE_SIZE;
  const end = Math.min(
    start + SHUFFLE_PARTIAL_PAGE_SIZE,
    SHUFFLE_PARTIAL_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    shufflePartialScenarioCard(start + offset)
  );
};

const scenarioPackPage = (
  scenario:
    | "card-details"
    | "keyboard-mixed"
    | "ordering"
    | "shuffle-partial"
    | "archive-mix"
    | "tags-2000"
    | "tags-case"
    | "search-qualifiers-1000",
  page: number
): DefaultCardDef[] => {
  if (scenario === "search-qualifiers-1000") {
    return searchQualifiersVolumePage(page);
  }
  if (scenario === "keyboard-mixed") {
    return page === 0
      ? Array.from({ length: KEYBOARD_MIXED_SCENARIO_SIZE }, (_, index) =>
          keyboardMixedScenarioCard(index)
        )
      : [];
  }
  if (scenario === "ordering") {
    return orderingScenarioPage(page);
  }
  if (scenario === "shuffle-partial") {
    return shufflePartialScenarioPage(page);
  }
  if (scenario === "tags-2000") {
    return tags2000ScenarioPage(page);
  }
  if (scenario === "tags-case") {
    return page === 0 ? TAGS_CASE_SCENARIO_CARDS : [];
  }
  if (scenario === "archive-mix") {
    return archiveMixScenarioPage(page);
  }
  return CARD_DETAILS_SCENARIO_CARDS;
};

export const seedScenario = internalMutation({
  args: {
    workosUserId: v.string(),
    scenario: v.union(
      v.literal("card-details"),
      v.literal("ordering"),
      v.literal("archive-mix"),
      v.literal("tags-2000"),
      v.literal("tags-case"),
      v.literal("folders-one"),
      v.literal("folders-500"),
      v.literal("card-in-50-folders"),
      v.literal("folders-ugly"),
      v.literal("search-qualifiers"),
      v.literal("search-qualifiers-1000"),
      v.literal("smart-folders"),
      v.literal("export-ugly"),
      v.literal("keyboard-mixed"),
      v.literal("shuffle-partial")
    ),
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
    const owner = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!owner) {
      throw new Error("No Teak owner is linked to that WorkOS user.");
    }
    if (isFolderScenario(scenario)) {
      return await seedFolderScenario(ctx, owner.teakUserId, scenario);
    }
    const cards = scenarioPackPage(scenario, page);
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
