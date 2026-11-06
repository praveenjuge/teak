import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
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
import { link, palette } from "./devSeed/helpers";
import { SCENARIOS } from "./devSeed/scenarios";
import { readIsDevDeployment } from "./env";
import {
  CLOUD_DEV_ACCOUNT_EMAIL,
  CLOUD_DEV_ACCOUNT_EMAIL_RANGE,
} from "./shared/devAccounts";
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
        "The dev account has no Teak owner yet; sign in with it once to create it."
      );
    }
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted_saved", (q) =>
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

const unknownScenarioMessage = () =>
  [
    "Unknown scenario. Packs:",
    ...SCENARIOS.map(({ name, description }) => `  ${name}: ${description}`),
  ].join("\n");

export const seedScenario = internalMutation({
  args: {
    workosUserId: v.string(),
    scenario: v.string(),
    page: v.optional(v.number()),
    origin: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(v.literal("seeded"), v.literal("already_seeded")),
    cards: v.number(),
    folders: v.optional(v.number()),
  }),
  handler: async (ctx, { workosUserId, scenario, page = 0, origin }) => {
    if (!readIsDevDeployment() && isWorkosProductionApi(workosApiBase())) {
      throw new Error(
        "devSeed runs only on the dev deployment (TEAK_DEV_DEPLOYMENT=true) or a local backend wired to the WorkOS emulator."
      );
    }
    const pack = SCENARIOS.find(({ name }) => name === scenario);
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
    return await pack.seed(ctx, owner.teakUserId, { page, origin });
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
