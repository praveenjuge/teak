import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  getAccountDeletionState,
  initiateAccountDeletion,
} from "./accountDeletion";
import {
  type DefaultCardDef,
  insertCompletedCards,
  ONBOARDING_CARD_CONTENTS,
} from "./card/defaultCards";
import { readIsDevDeployment } from "./env";
import {
  CLOUD_DEV_ACCOUNT_EMAIL,
  CLOUD_DEV_ACCOUNT_EMAIL_RANGE,
} from "./shared/devAccounts";
import { isWorkosProductionApi, workosApiBase } from "./shared/workosApi";

// Seed data for development accounts (`bun run dev`). It runs only on the
// shared dev deployment (TEAK_DEV_DEPLOYMENT=true) or a local backend wired to
// the WorkOS emulator; any other deployment refuses it. Card types that need
// stored files (image, video, audio, document) are left out. Link cards start
// pending and run through the real processing workflow, so their previews come
// from the page itself; every other card is inserted already processed.

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

/**
 * Fill a dev account's empty vault. The account is linked first by its
 * user.created webhook. Safe to re-run: a vault that holds anything beyond the
 * onboarding cards is left alone.
 */
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
    const onboarding: readonly string[] = ONBOARDING_CARD_CONTENTS;
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) => q.eq("userId", owner.teakUserId))
      .take(onboarding.length + 1);
    if (cards.some((card) => !onboarding.includes(card.content))) {
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

// A fixed permutation of 0..n-1 (multiplication by a unit mod n), so the
// pack is the same on every run.
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

const SCENARIO_PACKS = {
  "card-details": () => CARD_DETAILS_SCENARIO_CARDS,
  ordering: orderingScenarioPage,
} satisfies Record<string, (page: number) => DefaultCardDef[]>;

export const seedScenario = internalMutation({
  args: {
    workosUserId: v.string(),
    scenario: v.union(v.literal("card-details"), v.literal("ordering")),
    /** Large packs seed in pages: run with page 0, 1, 2… until done. */
    page: v.optional(v.number()),
  },
  returns: v.object({
    status: v.union(v.literal("seeded"), v.literal("already_seeded")),
    cards: v.number(),
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
    const cards = SCENARIO_PACKS[scenario](page);
    if (cards.length === 0) {
      return { status: "already_seeded" as const, cards: 0 };
    }
    // Each page has a link card with a marker URL; finding it (in or out of
    // Trash) means this page was seeded already.
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
    // Volume packs deliberately pass the free plan's card limit.
    await insertCompletedCards(ctx, owner.teakUserId, cards, {
      ignoreCardLimit: true,
    });
    return { status: "seeded" as const, cards: cards.length };
  },
});

// Every Claude Code cloud session gets its own dev account, and nothing else
// removes them once the session ends. `bun run dev` in a cloud session prunes
// the stale ones through the full account deletion workflow, which also
// deletes the WorkOS user. Unlike seeding, pruning runs only on the shared dev
// deployment, and only for cloud session accounts.

const assertPrunableDeployment = () => {
  if (!readIsDevDeployment()) {
    throw new Error(
      "Pruning cloud dev accounts runs only on the dev deployment (TEAK_DEV_DEPLOYMENT=true)."
    );
  }
};

const CLOUD_ACCOUNT_PAGE_SIZE = 100;

/**
 * One page of live cloud session accounts. Deleted owners keep their address,
 * so the range is paged rather than read in one bounded batch.
 */
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

/**
 * Delete a finished cloud session's dev account: its cards, files and WorkOS
 * user. Refuses every other account.
 */
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
