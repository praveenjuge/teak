import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  type DefaultCardDef,
  insertCompletedCards,
  ONBOARDING_CARD_CONTENTS,
} from "./card/defaultCards";
import { isWorkosProductionApi, workosApiBase } from "./shared/workosApi";

// Seed data for local development (`bun run dev`). It only runs on a backend
// wired to the local WorkOS emulator; a deployment that trusts production
// WorkOS refuses it. Card types that need stored files (image, video, audio,
// document) are left out: the local stack has no Files Worker.

const link = (
  url: string,
  title: string,
  description: string,
  siteName: string,
  extra: Partial<DefaultCardDef> = {}
): DefaultCardDef => ({
  type: "link",
  content: url,
  url,
  metadataTitle: title,
  metadataDescription: description,
  metadata: {
    linkPreview: {
      source: "dev-seed",
      status: "success",
      url,
      finalUrl: url,
      title,
      description,
      siteName,
    },
  },
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
  link(
    "https://docs.convex.dev/home",
    "Convex Docs",
    "Convex is the open source, reactive database where queries are TypeScript code running right in the database.",
    "Convex",
    { tags: ["dev"], isFavorited: true }
  ),
  link(
    "https://workos.com/docs/authkit",
    "AuthKit – WorkOS Docs",
    "A complete authentication platform with hosted sign-in, sessions and user management.",
    "WorkOS",
    { tags: ["dev"] }
  ),
  link(
    "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout",
    "CSS grid layout – MDN",
    "The CSS grid layout module excels at dividing a page into major regions.",
    "MDN Web Docs",
    { tags: ["dev", "design"] }
  ),
  link(
    "https://www.gutenberg.org/ebooks/1342",
    "Pride and Prejudice by Jane Austen",
    "Free ebook from Project Gutenberg.",
    "Project Gutenberg",
    { tags: ["reading"] }
  ),
  link(
    "https://en.wikipedia.org/wiki/Bauhaus",
    "Bauhaus – Wikipedia",
    "The Staatliches Bauhaus was a German art school operational from 1919 to 1933 that combined crafts and the fine arts.",
    "Wikipedia",
    { tags: ["design", "reading"] }
  ),
  link(
    "https://www.nasa.gov/image-of-the-day/",
    "Image of the Day – NASA",
    "A new image from NASA's archives every day.",
    "NASA",
    { tags: ["inspiration"] }
  ),
  link(
    "https://github.com/praveenjuge/teak",
    "praveenjuge/teak",
    "A personal knowledge hub for collecting, remembering, and rediscovering ideas and inspiration.",
    "GitHub",
    { tags: ["dev"], isFavorited: true }
  ),
  link(
    "https://web.dev/articles/vitals",
    "Web Vitals",
    "Essential metrics for a healthy site.",
    "web.dev",
    { tags: ["dev"] }
  ),
  link(
    "https://www.seriouseats.com/the-food-lab",
    "The Food Lab",
    "Better home cooking through science.",
    "Serious Eats",
    { tags: ["recipes"] }
  ),
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
 * Fill the dev account's empty vault. The account is linked first by the
 * signed user.created webhook the stack sends. Safe to re-run: a vault that
 * holds anything beyond the onboarding cards is left alone.
 */
export const seed = internalMutation({
  args: { workosUserId: v.string() },
  returns: v.object({
    status: v.union(v.literal("seeded"), v.literal("already_seeded")),
    cards: v.number(),
  }),
  handler: async (ctx, { workosUserId }) => {
    if (isWorkosProductionApi(workosApiBase())) {
      throw new Error(
        "devSeed runs only on a local backend wired to the WorkOS emulator."
      );
    }
    const owner = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!owner) {
      throw new Error(
        "The dev account has no Teak owner yet; its user.created webhook did not link it."
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
