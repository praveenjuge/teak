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
import { AUDIO_WAVEFORM } from "./card/onboarding/processed";
import { readIsDevDeployment } from "./env";
import { insertFolder } from "./folder/folders";
import { FREE_TIER_LIMIT } from "./shared/constants";
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
import { LINK_CATEGORIES, type LinkCategory } from "./shared/linkCategories";
import { parseSearchQuery } from "./shared/search/qualifiers";
import { isWorkosProductionApi, workosApiBase } from "./shared/workosApi";
import type { RemoteDetails } from "./workflows/steps/categorization/remote/index";
import {
  classifyLinkCategory,
  enrichLinkCategory,
} from "./workflows/steps/categorization/rules";

const link = (
  url: string,
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => ({
  type: "link",
  content: url,
  url,
  runProcessing: true,
  ...extra,
});

const palette = (
  content: string,
  hexes: string[],
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => ({
  type: "palette",
  content,
  colors: hexes.map((hex) => ({ hex })),
  ...extra,
});

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
      .withIndex("by_user_deleted", (q) => q.eq("userId", owner.teakUserId))
      .take(ONBOARDING_CARDS.length + 1);
    if (cards.some((card) => !isOnboardingCard(card))) {
      return { status: "already_seeded" as const, cards: 0 };
    }
    await insertCompletedCards(ctx, owner.teakUserId, DEV_SEED_CARDS);
    return { status: "seeded" as const, cards: DEV_SEED_CARDS.length };
  },
});

const SCENARIO_MARKER = "teak-scenario";

const bylineLink = (
  slug: string,
  url: string,
  linkPreview: Record<string, unknown>,
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => {
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

export const CARD_DETAILS_SCENARIO_CARDS: DevScenarioCardDef[] = [
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

export const orderingScenarioCard = (position: number): DevScenarioCardDef => {
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

const orderingScenarioPage = (page: number): DevScenarioCardDef[] => {
  const start = page * ORDERING_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ORDERING_SCENARIO_PAGE_SIZE,
    ORDERING_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    orderingScenarioCard(start + offset)
  );
};

export const ARCHIVE_MIX_SCENARIO_SIZE = 1000;
export const ARCHIVE_MIX_SCENARIO_PAGE_SIZE = 200;
const ARCHIVE_MIX_START = Date.UTC(2025, 0, 1);

export const archiveMixScenarioCard = (index: number): DevScenarioCardDef => {
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

const archiveMixScenarioPage = (page: number): DevScenarioCardDef[] => {
  const start = page * ARCHIVE_MIX_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ARCHIVE_MIX_SCENARIO_PAGE_SIZE,
    ARCHIVE_MIX_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    archiveMixScenarioCard(start + offset)
  );
};

export const TAGS_2000_SCENARIO_SIZE = 1000;
export const TAGS_2000_SCENARIO_PAGE_SIZE = 200;
const TAGS_2000_START = Date.UTC(2025, 6, 1);

export const tags2000ScenarioCard = (index: number): DevScenarioCardDef => {
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

const tags2000ScenarioPage = (page: number): DevScenarioCardDef[] => {
  const start = page * TAGS_2000_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + TAGS_2000_SCENARIO_PAGE_SIZE,
    TAGS_2000_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    tags2000ScenarioCard(start + offset)
  );
};

export const LONG_SCENARIO_TAG = `long-${"x".repeat(59)}`;

const tagsCaseCard = (
  slug: string,
  label: string,
  extra: Partial<DevScenarioCardDef>
): DevScenarioCardDef => {
  const url = `https://example.com/tags-case/${slug}#${SCENARIO_MARKER}-tags-case`;
  return {
    type: "link",
    content: url,
    url,
    metadataTitle: label,
    ...extra,
  };
};

export const TAGS_CASE_SCENARIO_CARDS: DevScenarioCardDef[] = [
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

export interface FolderScenarioCard
  extends Omit<DevScenarioCardDef, "folderIds"> {
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
  "palette-mixed",
  "focus-notes",
  "checklists",
  "hidden-mix",
  "revisit-sizes",
  "save-details",
  "omnibox-titles",
  "ocr-images",
  "ocr-documents",
  "ocr-links",
  "done-states",
  "rich-sites",
] as const;
export type FolderScenario = (typeof FOLDER_SCENARIOS)[number];

const FOLDER_SCENARIO_START = Date.UTC(2026, 8, 1);

const folderScenarioCard = (
  scenario: FolderScenario,
  index: number,
  label: string,
  folders: number[],
  extra: Partial<DevScenarioCardDef> = {}
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

const foldersOnePack = (): FolderScenarioPack => {
  const states: [string, Partial<DevScenarioCardDef>][] = [
    ...Array.from({ length: 8 }, (): [string, Partial<DevScenarioCardDef>] => [
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

const UGLY_CARD_STATES: Record<number, Partial<DevScenarioCardDef>> = {
  2: { isArchived: true },
  3: { isDeleted: true },
};

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
  const extraFor = (index: number): Partial<DevScenarioCardDef> => ({
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
    extra: Partial<DevScenarioCardDef> = {}
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

export const PALETTE_MIXED_SMART_FOLDERS = [
  { name: "🔍 Palette marker cards", query: "tag:scenario-palette-mixed" },
  { name: "بحث ذكي", query: "palette marker" },
  { name: "スマートフォルダ", query: "type:link" },
  { name: "Smart IDEAS", query: "#ideas" },
  { name: longName("Smart"), query: "saved" },
  { name: "🧭".repeat(MAX_FOLDER_NAME_LENGTH), query: "is:fav" },
  { name: "Nothing matches", query: "zzqx-no-such-card" },
  { name: "Ordering links", query: "tag:scenario-ordering type:link" },
  { name: "רשימה חכמה", query: "note" },
  { name: "Palette sky", query: "sky" },
  { name: "smart ideas", query: "ideas" },
];

const paletteMixedPack = (): FolderScenarioPack => {
  const scenario = "palette-mixed" as const;
  const manual = [
    ...UGLY_FOLDER_NAMES,
    ...Array.from(
      { length: 50 - (UGLY_FOLDER_NAMES.length - 2) },
      (_, index) => `Palette folder ${String(index + 1).padStart(2, "0")}`
    ),
  ];
  return {
    folders: [
      ...manual.map((name, index) => ({
        name,
        color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
      })),
      ...PALETTE_MIXED_SMART_FOLDERS,
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Palette marker link", [0]),
      ...[
        "Palette marker note",
        "Palette marker 🎨 emoji",
        "ملاحظة علامة اللوحة",
        "パレットのマーカー",
        `Palette marker ${longName("long")}`,
      ].map((label, index) =>
        folderScenarioCard(scenario, index + 1, label, [index + 1])
      ),
      folderScenarioCard(scenario, 6, "Palette marker archived", [], {
        isArchived: true,
      }),
      folderScenarioCard(scenario, 7, "Palette marker in Trash", [], {
        isDeleted: true,
      }),
    ],
  };
};

const FOCUS_SENTENCES = [
  "The quiet morning light settled over the desk while the draft slowly took shape.",
  "Every paragraph asks for one clear idea and enough room to breathe.",
  "Long notes are where thinking happens, so the page should get out of the way.",
  "She crossed out the second heading and wrote a simpler one underneath.",
];

export const FOCUS_LONG_NOTE_WORDS = 50_000;
const focusLongNote = (): string => {
  const paragraphs: string[] = ["# A very long draft"];
  let words = 4;
  let index = 0;
  while (words < FOCUS_LONG_NOTE_WORDS) {
    const sentences: string[] = [];
    for (let i = 0; i < 6 && words < FOCUS_LONG_NOTE_WORDS; i++) {
      const sentence = FOCUS_SENTENCES[index % FOCUS_SENTENCES.length] ?? "";
      const sentenceWords = sentence.split(" ");
      const room = FOCUS_LONG_NOTE_WORDS - words;
      sentences.push(sentenceWords.slice(0, room).join(" "));
      words += Math.min(sentenceWords.length, room);
      index += 1;
    }
    paragraphs.push(sentences.join(" "));
  }
  return paragraphs.join("\n\n");
};

export const FOCUS_LITERAL_NOTE = [
  "# Release checklist",
  "",
  "| Step | Owner | Done |",
  "| --- | --- | --- |",
  "| Build | CI | yes |",
  "| Smoke test | Web | no |",
  "",
  "```ts",
  "export const ready = (steps: string[]) => steps.length > 0;",
  "```",
].join("\n");

const focusNotesPack = (): FolderScenarioPack => {
  const scenario = "focus-notes" as const;
  const note = (index: number, content: string) =>
    folderScenarioCard(scenario, index, content, []);
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Focus notes pack", []),
      note(1, focusLongNote()),
      note(2, FOCUS_LITERAL_NOTE),
      note(3, ""),
      note(
        4,
        "東京の朝は静かで、ノートに考えを書きとめた。\n\n这是一段中文的笔记，用来测试字数。\n\nهذه ملاحظة قصيرة مكتوبة من اليمين إلى اليسار."
      ),
      note(
        5,
        `${longName("Focus")}\n\nThe body of a note whose first line is 300 characters.`
      ),
    ],
  };
};

export const SAVE_DETAILS_SAVED_URL = "https://example.com/already-saved";

const saveDetailsPack = (): FolderScenarioPack => {
  const scenario = "save-details" as const;
  const quote = (
    index: number,
    content: string,
    sourceUrl: string,
    sourceTitle?: string
  ) =>
    folderScenarioCard(scenario, index, content, [], {
      sourceTitle,
      sourceUrl,
    });
  const link = (
    index: number,
    url: string,
    extra: Partial<DevScenarioCardDef> = {}
  ) => ({
    ...folderScenarioCard(scenario, index, "", [], extra),
    type: "link" as const,
    content: url,
    url,
  });
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Save details pack", []),
      quote(
        1,
        "Simplicity is a great virtue, but it requires hard work to achieve it.",
        "https://www.example.com/essays/simplicity",
        "On simplicity"
      ),
      quote(
        2,
        "A selection from a page whose title runs to 300 characters.",
        "https://example.org/a-very-long-title",
        longName("Title")
      ),
      quote(
        3,
        "اقتباس قصير من صفحة مكتوبة من اليمين إلى اليسار.",
        "https://example.net/rtl",
        "عنوان الصفحة باللغة العربية"
      ),
      quote(4, "A line from an international site.", "https://例え.jp/page"),
      link(5, SAVE_DETAILS_SAVED_URL, {
        metadataTitle: "A page already saved",
        notes: "Saved earlier, with a note.",
        tags: [`scenario-${scenario}`, "design", "reading"],
      }),
      link(6, "https://github.com/acme/design-system", {
        metadataTitle: "A link found on another page",
        sourceTitle: "Where I found it",
        sourceUrl: "https://example.com/where-i-found-it",
      }),
    ],
  };
};

export const OMNIBOX_HIDDEN_TITLE = "Omnibox hidden card";

const omniboxTitlesPack = (): FolderScenarioPack => {
  const scenario = "omnibox-titles" as const;
  const titled = (
    index: number,
    metadataTitle: string,
    extra: Partial<DevScenarioCardDef> = {}
  ) => {
    const url = `https://omnibox-titles.example/${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", [], extra),
      type: "link" as const,
      content: url,
      url,
      metadataTitle,
    };
  };
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Omnibox plain title", []),
      titled(1, "Omnibox Tom & Jerry"),
      titled(2, "Omnibox <script>alert(1)</script>"),
      titled(3, `Omnibox "double" and 'single' quotes`),
      folderScenarioCard(
        scenario,
        4,
        "Omnibox note: 1 < 2 > 0, saved from a page",
        [],
        { sourceUrl: "https://www.example.com/omnibox-source" }
      ),
      titled(5, longName("Omnibox")),
      titled(6, "Omnibox 🧪🚀 emoji ✨"),
      titled(7, "Omnibox عنوان عربي من اليمين إلى اليسار"),
      titled(8, "Omnibox 東京の小さな喫茶店"),
      titled(9, ""),
      titled(10, OMNIBOX_HIDDEN_TITLE, {
        tags: [`scenario-${scenario}`, "secret"],
      }),
    ],
  };
};

export const OCR_SHARED_KEYWORD = "4411";

const ocrImagesPack = (): FolderScenarioPack => {
  const scenario = "ocr-images" as const;
  const colors = ["#1f2937", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];
  const image = (
    index: number,
    label: string,
    aiOcrText: string | undefined,
    extra: Partial<DevScenarioCardDef> = {}
  ) => ({
    ...folderScenarioCard(scenario, index, label, []),
    type: "image" as const,
    content: label,
    colors: [{ hex: colors[index % colors.length] as string }],
    fileMetadata: {
      fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      fileSize: 0,
      mimeType: "image/png",
      width: 1600,
      height: index % 3 === 0 ? 2000 : 1000,
    },
    ...(aiOcrText ? { aiOcrText } : {}),
    ...extra,
  });
  const note = (index: number, content: string) =>
    folderScenarioCard(scenario, index, content, []);
  const wall = Array.from(
    { length: 80 },
    (_, line) =>
      `Clause ${line + 1}. The tenant keeps the premises clean and returns every key.`
  )
    .join("\n")
    .slice(0, 4000);
  const images: [string, string | undefined][] = [
    [
      "Receipt ACME",
      `ACME MARKET\nInvoice ${OCR_SHARED_KEYWORD}\nMilk 2.40\nBread 3.10\nTotal due  $5.50`,
    ],
    [
      "Receipt cafe",
      "Café Lumière\nTable 7\n2 × Espresso 6.00\nTOTAL DUE 6.00\nMerci!",
    ],
    [
      "Receipt hardware",
      "BOLT & NUT CO.\nRef 98-221\nHex bolts M6 x 40\nSubtotal 12.80\nVAT 2.56\nTotal 15.36",
    ],
    [
      "Code TypeScript",
      "export const total = (items: Item[]) => {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return sum;\n};",
    ],
    [
      "Code Python",
      "def fizzbuzz(n):\n    for i in range(1, n + 1):\n        if i % 15 == 0:\n            print('FizzBuzz')\n        else:\n            print(i)",
    ],
    [
      "Code terminal",
      "$ bun run test\n 450 pass\n 0 fail\nRan 450 tests across 11 files.",
    ],
    ["Meme one does not simply", "ONE DOES NOT SIMPLY\nSHIP ON A FRIDAY"],
    ["Meme distracted", "MY ROADMAP\nNEW SHINY FRAMEWORK\nME"],
    [
      "Handwritten note",
      "Call mum on Sunday\nbuy stamps\nreturn library books by the 14th",
    ],
    [
      "Whiteboard",
      "Q4 goals:\n1. Search by image text\n2. Faster sync\n3. Fewer bugs",
    ],
    ["Arabic sign", "مرحبا بكم في المكتبة\nالدخول مجاني"],
    ["Hebrew sign", "ברוכים הבאים\nיציאה"],
    ["Japanese station", "東京駅\nTokyo Station\n丸の内北口"],
    ["Japanese menu", "本日のおすすめ\nラーメン ８５０円\n餃子 ４００円"],
    ["Hindi sign", "स्वागत है\nकृपया जूते बाहर उतारें"],
    ["Korean poster", "서울 재즈 페스티벌\n2026년 5월"],
    ["Chinese packaging", "绿茶\n净含量 250克"],
    ["Russian street sign", "Улица Пушкина\nдом 10"],
    ["Mixed Arabic and English", "Exit خروج\nGate 12 البوابة"],
    ["Emoji sticker", "Good vibes only ✨🌈\n#teamteak"],
    ["Wall of text", wall],
    ["Slide deck title", "Why we read the text in images\nTeak · October 2026"],
    ["Book cover", "THE QUIET ROOM\na novel\nMARA ELLISON"],
    ["Street parking sign", "NO PARKING\n8AM – 6PM\nMON–FRI\nTow-away zone"],
    ["Wifi card", "Network: Teak Guest\nAsk the front desk for the code"],
    ["Ticket stub", "ADMIT ONE\nRow F Seat 22\nDoors 19:30"],
    [
      "Error dialog",
      "Something went wrong\nError 0x80070005: Access is denied.\nOK",
    ],
    [
      "Recipe card",
      "Pancakes\n200 g flour\n2 eggs\n300 ml milk\nPinch of salt",
    ],
    ["Map label", "Old Harbour → 400 m\nLighthouse → 1.2 km"],
    ["Price tag", "SALE\n$19.99\nwas $34.99"],
    ["Quote poster", '"Simplicity is the ultimate sophistication."'],
    ["Tiny caption", "fig. 3"],
    ["Photo of a beach", undefined],
    ["Photo of a forest", undefined],
    ["Photo of a cat", undefined],
    ["Abstract gradient", undefined],
    ["Noise only", undefined],
  ];
  const videos: [string, string][] = [
    ["Trailer title card", `Episode ${OCR_SHARED_KEYWORD}\nThe Long Way Home`],
    [
      "Conference talk",
      "Building search that reads images\nSpeaker: A. Rivera",
    ],
    ["Tutorial intro", "How to brew pour-over coffee\nPart 1"],
  ];
  const twins = [
    `Note about invoice ${OCR_SHARED_KEYWORD} for the shop`,
    "Note: total due by Friday",
    "Note on the Tokyo Station meeting point",
    "Note: fizzbuzz interview question",
  ];
  let index = 1;
  const cards = [
    folderScenarioCard(scenario, 0, "OCR images pack", []),
    ...images.map(([label, text]) => image(index++, label, text)),
    ...videos.map(([label, text]) =>
      image(index++, label, text, {
        type: "video",
        fileMetadata: {
          fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`,
          fileSize: 0,
          mimeType: "video/mp4",
          width: 1920,
          height: 1080,
          duration: 30,
        },
      })
    ),
    ...twins.map((content) => note(index++, content)),
  ];
  return { folders: [], cards };
};

export const OCR_LEASE_PHRASE = "lease agreement";

const ocrDocumentsPack = (): FolderScenarioPack => {
  const scenario = "ocr-documents" as const;
  const pdf = (
    index: number,
    label: string,
    aiOcrText: string | undefined,
    aiSummary: string,
    fileSize = 2_400_000
  ) => ({
    ...folderScenarioCard(scenario, index, label, []),
    type: "document" as const,
    content: "",
    aiSummary,
    aiTags: ["document", "scan"],
    fileMetadata: {
      fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
      fileSize,
      mimeType: "application/pdf",
    },
    ...(aiOcrText ? { aiOcrText } : {}),
  });
  const pages = (...texts: string[]) => texts.join("\n\n");
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "OCR documents pack", []),
      pdf(
        index++,
        "Scanned lease",
        pages(
          "RESIDENTIAL TENANCY\nPrepared for Dana Reyes",
          "LEASE AGREEMENT\nThis lease is made on 1 May 2026 between\nHarbour Homes Ltd (landlord) and Dana Reyes (tenant).",
          "Rent: $1,450 per month, due on the 1st.\nDeposit: $2,900"
        ),
        "A residential lease between Harbour Homes and Dana Reyes, with rent and deposit terms."
      ),
      pdf(
        index++,
        "Board minutes archive 1998",
        pages(
          "MINUTES OF THE BOARD\nVolume 12 · 1998",
          "Present: J. Okafor, M. Lindqvist, R. Patel\nApologies: none",
          "1. The treasurer reported a surplus of 4,210."
        ),
        "The first pages of a 300-page archive of 1998 board minutes.",
        99_000_000
      ),
      pdf(
        index++,
        "Scan with a footer",
        pages(
          "Delivery note 55-1902\nReceived in good condition",
          "Signed: P. Moreau"
        ),
        "A signed delivery note scanned to PDF."
      ),
      pdf(
        index++,
        "Arabic contract scan",
        "عقد إيجار\nالطرف الأول: شركة الميناء\nالإيجار الشهري: ٥٠٠٠",
        "A rental contract in Arabic."
      ),
      pdf(
        index++,
        "Chinese invoice scan",
        "发票\n客户：茶叶有限公司\n金额：￥1,280",
        "An invoice in Chinese for a tea company."
      ),
      pdf(
        index++,
        "Mixed PDF",
        undefined,
        "A report with a text first page; its own text is already searchable."
      ),
      pdf(
        index++,
        "Locked PDF",
        undefined,
        "A password-protected PDF that couldn't be opened."
      ),
      pdf(
        index++,
        "Lease template",
        undefined,
        "A blank lease template with a text layer."
      ),
      folderScenarioCard(
        scenario,
        index++,
        `Note: send the ${OCR_LEASE_PHRASE} to Dana`,
        []
      ),
    ],
  };
};

const ocrLinksPack = (): FolderScenarioPack => {
  const scenario = "ocr-links" as const;
  const link = (
    index: number,
    url: string,
    title: string,
    aiOcrText: string | undefined
  ) => {
    const markedUrl = `${url}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", []),
      type: "link" as const,
      content: markedUrl,
      url: markedUrl,
      metadataTitle: title,
      metadata: {
        linkPreview: {
          source: "scenario",
          status: "success",
          fetchedAt: Date.UTC(2026, 9, 1),
          url: markedUrl,
          finalUrl: markedUrl,
          title,
        } as never,
      },
      ...(aiOcrText ? { aiOcrText } : {}),
    };
  };
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "OCR links pack", []),
      link(
        index++,
        "https://example.com/talks/postgres",
        "Conference talk recording",
        "SCALING POSTGRES\nto a million users\nA. Rivera · Data Day 2026"
      ),
      link(
        index++,
        "https://docs.example.com/getting-started",
        "Getting started",
        "Docs › Getting started\nInstall the CLI\nnpm install -g teak-cli"
      ),
      link(
        index++,
        "https://blog.example.com/fast-json",
        "Parsing JSON faster",
        "for (const byte of buffer) {\n  if (byte === QUOTE) inString = !inString;\n}"
      ),
      link(
        index++,
        "https://news.example.com/ar/harbour",
        "أخبار الميناء",
        "افتتاح الميناء الجديد\nالأحد ١٢ أكتوبر"
      ),
      link(
        index++,
        "https://app.example.com/dashboard",
        "Single-page app",
        undefined
      ),
      folderScenarioCard(
        scenario,
        index++,
        "Note: watch the scaling postgres talk",
        []
      ),
    ],
  };
};

const DONE_STATES_DONE_AT = Date.UTC(2026, 9, 10);

const doneStatesPack = (): FolderScenarioPack => {
  const scenario = "done-states" as const;
  const link = (
    index: number,
    title: string,
    category: LinkCategory | undefined,
    extra: Partial<DevScenarioCardDef> = {},
    folders: number[] = []
  ) => {
    const url = `https://example.com/${scenario}/${index}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", folders, extra),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
      ...(category
        ? {
            metadata: {
              linkCategory: {
                category,
                fetchedAt: Date.UTC(2026, 9, 1),
                sourceUrl: url,
              },
            },
          }
        : {}),
    };
  };
  const done = { completedAt: DONE_STATES_DONE_AT };
  let index = 1;
  return {
    folders: [
      { name: "Reading list", color: "blue" },
      {
        name: "Left to read",
        color: "green",
        query: 'is:todo folder:"Reading list"',
      },
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Done states pack", []),
      ...LINK_CATEGORIES.map((category, position) =>
        link(
          index++,
          `A ${category.replace("_", " ")} link${position % 2 ? " (done)" : ""}`,
          category,
          position % 2 ? done : {},
          category === "article" || category === "book" ? [0] : []
        )
      ),
      link(index++, "A done article in Trash", "article", {
        ...done,
        isDeleted: true,
      }),
      link(index++, "A done film in Archive", "movie", {
        ...done,
        isArchived: true,
      }),
      link(index++, "A link still being read", undefined),
      link(index++, "x".repeat(300), "book", done),
      link(index++, "مقالة مقروءة عن تصميم الخطوط", "article", done),
      link(index++, "読み終えた長編小説の感想", "book", done),
    ],
  };
};
const richSitesPack = (): FolderScenarioPack => {
  const scenario = "rich-sites" as const;
  const updated = "Oct 15, 2026";
  const link = (
    index: number,
    url: string,
    preview: { description?: string; siteName: string; title: string },
    remote?: RemoteDetails,
    raw: { selector: string; value: string }[] = []
  ) => {
    const marked = `${url}#${SCENARIO_MARKER}-${scenario}-${index}`;
    const linkPreview = {
      status: "success" as const,
      url: marked,
      ...preview,
      ...(raw.length
        ? {
            raw: raw.map(({ selector, value }) => ({
              selector,
              results: [{ attributes: [{ name: "content", value }] }],
            })),
          }
        : {}),
    };
    const card = {
      _id: `${scenario}-${index}`,
      type: "link",
      url: marked,
      metadata: { linkPreview },
    };
    const classification = classifyLinkCategory(card);
    return {
      ...folderScenarioCard(scenario, index, "", []),
      type: "link" as const,
      content: marked,
      url: marked,
      metadataTitle: preview.title,
      metadata: {
        linkPreview,
        ...(classification
          ? {
              linkCategory: enrichLinkCategory(card, classification, {
                remote,
              }),
            }
          : {}),
      },
    };
  };
  const wikipedia = { siteName: "Wikipedia" };
  const arxiv = { siteName: "arXiv.org" };
  const isbnTag = (value: string) => [
    { selector: "meta[property='books:isbn']", value },
  ];
  const openLibrary = (isbn: string, pages: string): RemoteDetails => ({
    source: "open_library",
    facts: [
      { label: "Authors", value: "Example Author" },
      { label: "Pages", value: pages },
      { label: "Publisher", value: "Example Press" },
      { label: "Published", value: "October 1, 1988" },
      { label: "ISBN", value: isbn },
    ],
  });
  const paper = (
    authors: string,
    published: string,
    subject: string,
    extra: Partial<RemoteDetails> = {}
  ): RemoteDetails => ({
    source: "arxiv",
    facts: [
      { label: "Authors", value: authors },
      { label: "Published", value: published },
      { label: "Subject", value: subject },
      ...(extra.facts ?? []),
    ],
    summary: "An abstract the AI summary reads.",
    ...(extra.pdfUrl ? { pdfUrl: extra.pdfUrl } : {}),
  });
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Rich sites pack", []),
      link(
        index++,
        "https://en.wikipedia.org/wiki/Photosynthesis",
        { ...wikipedia, title: "Photosynthesis" },
        {
          source: "wikipedia",
          facts: [
            {
              label: "About",
              value: "Biological process to convert light into chemical energy",
            },
            { label: "Updated", value: updated },
          ],
          summary: "Photosynthesis turns light into chemical energy.",
        }
      ),
      link(
        index++,
        "https://en.wikipedia.org/wiki/Mercury",
        { ...wikipedia, title: "Mercury" },
        {
          source: "wikipedia",
          facts: [
            { label: "Page", value: "Disambiguation" },
            { label: "Updated", value: "Oct 13, 2026" },
          ],
        }
      ),
      link(
        index++,
        "https://ja.wikipedia.org/wiki/%E5%AF%8C%E5%A3%AB%E5%B1%B1",
        { ...wikipedia, title: "富士山" },
        {
          source: "wikipedia",
          facts: [
            {
              label: "About",
              value:
                "静岡県と山梨県にまたがる活火山で、日本の最高峰。古くから信仰と芸術の対象として親しまれてきた山",
            },
            { label: "Updated", value: updated },
          ],
        }
      ),
      link(index++, "https://en.wikipedia.org/wiki/Zzzz_no_such_page", {
        ...wikipedia,
        title: "Wikipedia has no page with this name",
      }),
      link(
        index++,
        "https://arxiv.org/abs/1706.03762",
        { ...arxiv, title: "A paper with a PDF to save" },
        paper(
          "Author One, Author Two, Author Three et al.",
          "Jun 12, 2017",
          "cs.CL",
          {
            pdfUrl: "https://arxiv.org/pdf/1706.03762",
          }
        )
      ),
      link(
        index++,
        "https://arxiv.org/abs/hep-th/9901001",
        { ...arxiv, title: "A paper with an old-style id" },
        paper("Author One", "Jan 1, 1999", "hep-th", {
          facts: [{ label: "DOI", value: "10.1143/PTP.101.1155" }],
          pdfUrl: "https://arxiv.org/pdf/hep-th/9901001",
        })
      ),
      link(
        index++,
        "https://arxiv.org/abs/0910.4008",
        { ...arxiv, title: "A withdrawn paper" },
        paper("Author One", "Oct 21, 2009", "math.FA")
      ),
      link(
        index++,
        "https://arxiv.org/abs/2101.00001",
        { ...arxiv, title: "A paper with 300 authors" },
        paper("Author 1, Author 2, Author 3 et al.", "Jan 1, 2021", "hep-ex", {
          pdfUrl: "https://arxiv.org/pdf/2101.00001",
        })
      ),
      ...(
        [
          [
            "track/4uLU6hMCjMI75M1A2tKUQC",
            "A track",
            "Track",
            "Example Artist",
          ],
          ["album/1DFixLWuPkv3KT3TnV35m3", "An album", "Album", "Example Band"],
          ["playlist/37i9dQZF1DXcBWIGoYBM5M", "A playlist", "Playlist", ""],
          [
            "track/0000000000000000000000",
            "A region-locked track",
            "Track",
            "Example Artist",
          ],
        ] as const
      ).map(([path, title, type, artist]) =>
        link(
          index++,
          `https://open.spotify.com/${path}`,
          { siteName: "Spotify", title },
          {
            source: "spotify",
            facts: [
              ...(artist ? [{ label: "Artist", value: artist }] : []),
              { label: "Type", value: type },
            ],
          }
        )
      ),
      link(
        index++,
        "https://music.apple.com/us/album/example-album/1700000000",
        { siteName: "Apple Music", title: "An album on Apple Music" },
        {
          source: "apple_music",
          facts: [
            { label: "Artist", value: "Example Artist" },
            { label: "Type", value: "Album" },
            { label: "Released", value: "Oct 27, 2023" },
          ],
        }
      ),
      link(
        index++,
        "https://www.goodreads.com/book/show/6693",
        { siteName: "Goodreads", title: "A book with an ISBN-13" },
        openLibrary("9780140328721", "96"),
        isbnTag("9780140328721")
      ),
      link(
        index++,
        "https://www.goodreads.com/book/show/6694",
        { siteName: "Goodreads", title: "A book with only an ISBN-10" },
        openLibrary("9780140328721", "112"),
        isbnTag("0140328726")
      ),
      link(index++, "https://www.goodreads.com/book/show/6695", {
        siteName: "Goodreads",
        title: "A book with no ISBN",
      }),
      link(
        index++,
        "https://www.goodreads.com/book/show/6696",
        {
          siteName: "Goodreads",
          title: "A book whose ISBN check digit is wrong",
        },
        undefined,
        isbnTag("9780140328722")
      ),
      link(
        index++,
        "https://www.goodreads.com/book/show/6697",
        { siteName: "Goodreads", title: "A book Open Library doesn't know" },
        undefined,
        isbnTag("9781234567897")
      ),
    ],
  };
};

export const DONE_STATES_IMAGES_SIZE = 1000;
const DONE_STATES_IMAGES_PAGE_SIZE = 200;

const doneStatesImagesPage = (page: number): DevScenarioCardDef[] => {
  const start = page * DONE_STATES_IMAGES_PAGE_SIZE;
  const end = Math.min(
    start + DONE_STATES_IMAGES_PAGE_SIZE,
    DONE_STATES_IMAGES_SIZE
  );
  if (end <= start) {
    return [];
  }
  const marker = `https://example.com/done-states-images#${SCENARIO_MARKER}-${page}`;
  const images = Array.from({ length: end - start }, (_, offset) => {
    const index = start + offset;
    return {
      type: "image" as const,
      content: `Image ${String(index).padStart(4, "0")}`,
      createdAt: FOLDER_SCENARIO_START + index * 60_000,
      tags: ["scenario-done-states-images"],
      colors: [{ hex: index % 2 ? "#3b82f6" : "#f59e0b" }],
      fileMetadata: {
        fileName: `done-states-${index}.png`,
        fileSize: 0,
        mimeType: "image/png",
        width: 1200,
        height: 900,
      },
    };
  });
  return [
    {
      type: "link",
      content: marker,
      url: marker,
      metadataTitle: `Done states images, page ${page + 1}`,
      tags: ["scenario-done-states-images"],
    },
    ...images,
  ];
};

export const CHECKLIST_LONG_ITEMS = 200;

const checklistsPack = (): FolderScenarioPack => {
  const scenario = "checklists" as const;
  const note = (index: number, content: string) =>
    folderScenarioCard(scenario, index, content, []);
  const tasks = (count: number, label: string) =>
    Array.from(
      { length: count },
      (_, i) => `- [ ] ${label} ${String(i + 1).padStart(3, "0")}`
    ).join("\n");
  const nested = [0, 1, 2, 3, 4]
    .flatMap((depth) => {
      const indent = "  ".repeat(depth);
      return [
        `${indent}- [ ] Level ${depth + 1} first`,
        `${indent}- [ ] Level ${depth + 1} second`,
      ];
    })
    .join("\n");
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Checklists pack", []),
      note(1, `# Packing list\n\n${tasks(10, "Pack item")}`),
      note(2, `# Long checklist\n\n${tasks(CHECKLIST_LONG_ITEMS, "Step")}`),
      note(3, `# Nested checklist\n\n${nested}`),
      note(
        4,
        "# Mixed lists\n\n- A plain bullet\n- Another bullet\n\nThen the tasks:\n\n- [ ] Open task\n- [ ] Second task\n- [x] Done task"
      ),
      note(
        5,
        "# All done\n\n- [x] Wrote it\n- [x] Checked it\n- [x] Shipped it"
      ),
      note(
        6,
        "# Odd spacing\n\n-  [ ] Two spaces\n\n- [ ] Blank line above\n* [ ] Star bullet"
      ),
      note(
        7,
        "# Quoted checklist\n\n> - [ ] Quoted first\n> - [ ] Quoted second"
      ),
      note(
        8,
        "# Checklist with a table\n\n| Task | Owner |\n| --- | --- |\n| Review | Web |\n\n- [ ] Table note first\n- [ ] Table note second"
      ),
    ],
  };
};

const hiddenMixPack = (): FolderScenarioPack => {
  const scenario = "hidden-mix" as const;
  const tagged = (...tags: string[]) => ({
    tags: [`scenario-${scenario}`, ...tags],
  });
  const card = (
    index: number,
    label: string,
    folders: number[],
    extra: Partial<DevScenarioCardDef> = {}
  ) => folderScenarioCard(scenario, index, label, folders, extra);
  const hostLink = (index: number, title: string, tags: string[]) => {
    const url = `https://hidden-mix.example/${index}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...card(index, "", [], tagged(...tags)),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
    };
  };
  return {
    folders: [
      { name: "Hidden mix folder", color: "violet" },
      { name: "Hidden mix smart", query: `tag:scenario-${scenario}` },
      {
        name: "Hidden mix secret",
        color: "gray",
        query: `#secret tag:scenario-${scenario}`,
      },
    ],
    cards: [
      card(0, "Hidden mix pack", []),
      card(1, "Hidden: tagged Secret", [], tagged("Secret")),
      card(
        2,
        "Hidden: tagged HIDDEN with a trailing space",
        [],
        tagged("HIDDEN ")
      ),
      card(
        3,
        "Hidden: tagged hidden with a leading space",
        [],
        tagged(" hidden")
      ),
      card(4, "Hidden: a favorite", [], {
        ...tagged("secret"),
        isFavorited: true,
      }),
      card(5, "Hidden: archived", [], {
        ...tagged("secret"),
        isArchived: true,
      }),
      card(6, "Hidden: in Trash", [], {
        ...tagged("secret"),
        isDeleted: true,
      }),
      card(7, "Hidden: in a folder", [0], tagged("secret")),
      hostLink(8, "Hidden: a link on hidden-mix.example", ["secret"]),
      card(9, "Shown: hidden is only an AI tag", [], { aiTags: ["hidden"] }),
      card(10, "Shown: in the folder", [0]),
      hostLink(11, "Shown: a link on hidden-mix.example", []),
    ],
  };
};

export const REVISIT_SIZE_GROUPS = [0, 1, 19, 20, 21] as const;

const REVISIT_START = Date.UTC(2019, 2, 1);
const REVISIT_SHAPES = [
  "text",
  "quote",
  "link",
  "palette",
  "image",
  "very tall image",
  "video",
  "audio",
  "document",
  "long title",
] as const;

const revisitCard = (
  shape: (typeof REVISIT_SHAPES)[number],
  label: string
): Partial<DevScenarioCardDef> &
  Pick<DevScenarioCardDef, "content" | "type"> => {
  const color = { hex: "#4d96ff" };
  const file = (
    fileName: string,
    mimeType: string,
    size: { duration?: number; height?: number; width?: number }
  ) => ({ fileMetadata: { fileName, fileSize: 0, mimeType, ...size } });
  switch (shape) {
    case "quote":
      return { type: "quote", content: `${label}: keep what still matters.` };
    case "link": {
      const url = `https://revisit.example/${encodeURIComponent(label)}`;
      return { type: "link", content: url, url, metadataTitle: label };
    }
    case "palette":
      return {
        type: "palette",
        content: label,
        colors: [{ hex: "#ff6b6b" }, { hex: "#ffd93d" }, { hex: "#6bcb77" }],
      };
    case "image":
      return {
        type: "image",
        content: label,
        colors: [color],
        ...file(`${label}.png`, "image/png", { width: 1600, height: 1000 }),
      };
    case "very tall image":
      return {
        type: "image",
        content: label,
        colors: [{ hex: "#6bcb77" }],
        ...file(`${label}.png`, "image/png", { width: 400, height: 2400 }),
      };
    case "video":
      return {
        type: "video",
        content: label,
        metadataTitle: `${label}.mp4`,
        ...file(`${label}.mp4`, "video/mp4", {
          width: 1920,
          height: 1080,
          duration: 12,
        }),
      };
    case "audio":
      return {
        type: "audio",
        content: label,
        metadataTitle: `${label}.m4a`,
        fileMetadata: {
          ...file(`${label}.m4a`, "audio/mp4", { duration: 17.8 }).fileMetadata,
          waveform: AUDIO_WAVEFORM,
        },
      };
    case "document":
      return {
        type: "document",
        content: label,
        ...file(`${label}.pdf`, "application/pdf", {}),
      };
    case "long title":
      return {
        type: "text",
        content:
          `${label} ${"a very long first line that keeps going ".repeat(8)}`.slice(
            0,
            300
          ),
      };
    default:
      return { type: "text", content: `${label}\nA note saved years ago.` };
  }
};

const revisitSizesPack = (): FolderScenarioPack => {
  const scenario = "revisit-sizes" as const;
  const cards: FolderScenarioCard[] = [
    folderScenarioCard(scenario, 0, "Revisit sizes pack", []),
  ];
  let index = 1;
  for (const size of REVISIT_SIZE_GROUPS) {
    const tag = `rv${size}`;
    for (let position = 1; position <= size; position += 1) {
      const shape =
        REVISIT_SHAPES[(position - 1) % REVISIT_SHAPES.length] ?? "text";
      cards.push({
        ...revisitCard(shape, `${tag} ${position} of ${size} (${shape})`),
        createdAt: REVISIT_START + index * 86_400_000 * 11,
        folders: [],
        tags: [`scenario-${scenario}`, tag],
      });
      index += 1;
    }
    cards.push({
      type: "text",
      content: `${tag} hidden: Revisit must never deal this card`,
      createdAt: REVISIT_START + index * 86_400_000 * 11,
      folders: [],
      tags: [`scenario-${scenario}`, tag, "secret"],
    });
    index += 1;
  }
  return { folders: [], cards };
};

export const HIDDEN_MIX_VOLUME_SIZE = ORDERING_SCENARIO_SIZE;

export const hiddenMixVolumeCard = (position: number): DevScenarioCardDef => {
  const ordering = orderingScenarioCard(position);
  const index = orderingIndexAt(position);
  const hidden = index % 5 === 0;
  return {
    ...ordering,
    ...(ordering.url
      ? {
          url: ordering.url.replace("/ordering/", "/hidden-mix-1000/"),
          content: ordering.url.replace("/ordering/", "/hidden-mix-1000/"),
        }
      : {}),
    tags: ["scenario-hidden-mix-1000", ...(hidden ? ["secret"] : [])],
  };
};

const hiddenMixVolumePage = (page: number): DevScenarioCardDef[] => {
  const start = page * ORDERING_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ORDERING_SCENARIO_PAGE_SIZE,
    HIDDEN_MIX_VOLUME_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    hiddenMixVolumeCard(start + offset)
  );
};

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

export const SEARCH_QUALIFIERS_VOLUME_SIZE = 1000;
export const SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE = 200;
const SEARCH_QUALIFIERS_VOLUME_START = Date.UTC(2024, 0, 1);
const VOLUME_RARE_HOSTS = [
  "github.com",
  "www.figma.com",
  "例え.jp",
  "blog.example.com",
] as const;

export const searchQualifiersVolumeCard = (
  index: number
): DevScenarioCardDef => {
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

const searchQualifiersVolumePage = (page: number): DevScenarioCardDef[] => {
  const start = page * SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE;
  const end = Math.min(
    start + SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE,
    SEARCH_QUALIFIERS_VOLUME_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    searchQualifiersVolumeCard(start + offset)
  );
};

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

export const keyboardMixedScenarioCard = (
  index: number
): DevScenarioCardDef => {
  const shape = KEYBOARD_MIXED_SHAPES[index % KEYBOARD_MIXED_SHAPES.length];
  const label = `Keyboard mix #${String(index).padStart(2, "0")} ${shape}`;
  const color =
    KEYBOARD_MIXED_COLORS[index % KEYBOARD_MIXED_COLORS.length] ?? "#1f6feb";
  const base = {
    createdAt: KEYBOARD_MIXED_START + index * 60_000,
    tags: ["scenario-keyboard-mixed"],
  };
  const block = (width: number, height: number): DevScenarioCardDef => ({
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

export const SHUFFLE_PARTIAL_SCENARIO_SIZE = 400;
const SHUFFLE_PARTIAL_PAGE_SIZE = 200;
const SHUFFLE_PARTIAL_START = Date.UTC(2024, 0, 1);
const SHUFFLE_PARTIAL_TYPES = ["text", "quote", "palette"] as const;

export const shufflePartialScenarioCard = (
  index: number
): DevScenarioCardDef => {
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

const shufflePartialScenarioPage = (page: number): DevScenarioCardDef[] => {
  const start = page * SHUFFLE_PARTIAL_PAGE_SIZE;
  const end = Math.min(
    start + SHUFFLE_PARTIAL_PAGE_SIZE,
    SHUFFLE_PARTIAL_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    shufflePartialScenarioCard(start + offset)
  );
};

type ScenarioPack = { description: string } & (
  | { cards: (page: number) => DevScenarioCardDef[] }
  | { folders: () => FolderScenarioPack }
  | { fillTo: number }
);

const FILL_START = Date.UTC(2025, 0, 1);

const fillScenarioCards = async (
  ctx: MutationCtx,
  userId: string,
  target: number
) => {
  const active = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) =>
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
    if ("folders" in pack) {
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
