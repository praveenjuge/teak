// Seed packs for `[[…]]` card links: the cards are inserted first, then the
// notes that link to them, since a link names its target's id.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
} from "../card/defaultCards";
import { syncCardSearch } from "../card/searchSync";
import { formatCardLinkToken } from "../shared/cardLinks";

export const CARD_LINK_SCENARIOS = ["card-links", "backlinks"] as const;
export type CardLinkScenario = (typeof CARD_LINK_SCENARIOS)[number];

const START = Date.UTC(2026, 9, 1);
const LONG_TITLE = `A very long target title ${"that keeps going ".repeat(17)}`
  .slice(0, 300)
  .trim();
/** Looks like a card id, but no card has it: a link to it is missing. */
const UNKNOWN_ID = "j57unknowncard00000000000000000000";

const link = (title: string, id: string) => formatCardLinkToken(title, id);

const marker = (scenario: CardLinkScenario) =>
  `https://example.com/${scenario}#teak-scenario-${scenario}`;

const card = (
  scenario: CardLinkScenario,
  index: number,
  content: string,
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => ({
  content,
  createdAt: START + index * 60_000,
  tags: [`scenario-${scenario}`],
  type: "text",
  ...extra,
});

/** Rewrites a seeded note's content; the search sync rebuilds its links. */
const setContent = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">,
  content: string
) => {
  const previous = (await ctx.db.get("cards", cardId)) as Doc<"cards">;
  await ctx.db.patch("cards", cardId, { content });
  await syncCardSearch(ctx, cardId, userId, previous);
};

const deletedCardId = async (ctx: MutationCtx, userId: string) => {
  const id = await ctx.db.insert("cards", {
    content: "Deleted at once",
    createdAt: START,
    type: "text",
    updatedAt: START,
    userId,
  });
  await ctx.db.delete("cards", id);
  return id;
};

const alreadySeeded = async (
  ctx: MutationCtx,
  userId: string,
  scenario: CardLinkScenario
) =>
  Boolean(
    await ctx.db
      .query("cards")
      .withIndex("by_user_url_deleted", (q) =>
        q.eq("userId", userId).eq("url", marker(scenario))
      )
      .first()
  );

const insertMarker = (
  ctx: MutationCtx,
  userId: string,
  scenario: CardLinkScenario,
  label: string
) =>
  insertCompletedCards(
    ctx,
    userId,
    [
      card(scenario, 0, marker(scenario), {
        metadataTitle: label,
        type: "link",
        url: marker(scenario),
      }),
    ],
    { ignoreCardLimit: true }
  );

/** Real targets for the 500- and 501-link notes; the rest are missing. */
const MANY_LINK_TARGETS = 120;

const seedCardLinks = async (ctx: MutationCtx, userId: string) => {
  const scenario = "card-links" as const;
  await insertMarker(ctx, userId, scenario, "Card links pack");
  const [garden, reading, trip, longTitle, rtl, cjk, emoji, renamed, trashed] =
    await insertCompletedCards(
      ctx,
      userId,
      [
        card(scenario, 1, "Garden plan\n\nTomatoes by the fence."),
        card(scenario, 2, "Reading list\n\nThree books for May."),
        card(scenario, 3, "Trip notes\n\nTrain at 9."),
        card(scenario, 4, `${LONG_TITLE}\n\nBody.`),
        card(scenario, 5, "רשימת קניות\n\nחלב ולחם."),
        card(scenario, 6, "東京の旅行メモ\n\n朝の電車。"),
        card(scenario, 7, "🌱 Seedlings 🌿\n\nWater daily."),
        card(scenario, 8, "Renamed after linking\n\nIt was 'Old name'."),
        card(scenario, 9, "Trashed target\n\nIn Trash.", { isDeleted: true }),
      ],
      { ignoreCardLimit: true }
    );
  const manyTargets = await insertCompletedCards(
    ctx,
    userId,
    Array.from({ length: MANY_LINK_TARGETS }, (_, index) =>
      card(scenario, 20 + index, `Target ${index + 1}`)
    ),
    { ignoreCardLimit: true }
  );
  const deleted = await deletedCardId(ctx, userId);
  const manyIds = (count: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        manyTargets[index] ??
        `j57missing${String(index).padStart(22, "0")}`.slice(0, 32)
    );

  const notes = await insertCompletedCards(
    ctx,
    userId,
    Array.from({ length: 8 }, (_, index) =>
      card(scenario, 200 + index, "Linking note")
    ),
    { ignoreCardLimit: true }
  );
  const [self, broken, many, tooMany, cycleA, cycleB, cycleC, code] = notes;
  const contents: [Id<"cards"> | undefined, string][] = [
    [self, `Links to itself: ${link("Me", self ?? "")}`],
    [
      broken,
      [
        "Broken links",
        "",
        `- In Trash: ${link("Trashed target", trashed ?? "")}`,
        `- Deleted: ${link("Gone", deleted)}`,
        `- Not yours: ${link("Someone else's", UNKNOWN_ID)}`,
        `- Renamed: ${link("Old name", renamed ?? "")}`,
        `- Long: ${link(LONG_TITLE, longTitle ?? "")}`,
        `- RTL ${link("רשימת קניות", rtl ?? "")}, CJK ${link("東京の旅行メモ", cjk ?? "")}, emoji ${link("🌱 Seedlings 🌿", emoji ?? "")}`,
      ].join("\n"),
    ],
    [
      many,
      `500 links\n\n${manyIds(500)
        .map((id, index) => link(`Target ${index + 1}`, id))
        .join(" ")}`,
    ],
    [
      tooMany,
      `501 links\n\n${manyIds(501)
        .map((id, index) => link(`Target ${index + 1}`, id))
        .join(" ")}`,
    ],
    [cycleA, `Cycle A → ${link("Cycle B", cycleB ?? "")}`],
    [cycleB, `Cycle B → ${link("Cycle C", cycleC ?? "")}`],
    [cycleC, `Cycle C → ${link("Cycle A", cycleA ?? "")}`],
    [
      code,
      [
        "Tokens that are not links",
        "",
        `Inline \`${link("Garden plan", garden ?? "")}\` code.`,
        "",
        "```",
        link("Reading list", reading ?? ""),
        "```",
        "",
        `Malformed: [[x|teak:]] and [[x]]. A real one: ${link("Trip notes", trip ?? "")}`,
      ].join("\n"),
    ],
  ];
  for (const [id, content] of contents) {
    if (id) {
      await setContent(ctx, userId, id, content);
    }
  }
  return 1 + 9 + MANY_LINK_TARGETS + notes.length;
};

/** One hub source is archived, one is in Trash. */
const sourceExtra = (index: number): Partial<DevScenarioCardDef> => {
  if (index === 4) {
    return { isArchived: true };
  }
  return index === 5 ? { isDeleted: true } : {};
};

const seedBacklinks = async (ctx: MutationCtx, userId: string) => {
  const scenario = "backlinks" as const;
  await insertMarker(ctx, userId, scenario, "Backlinks pack");
  const [hub, crowded, cycleA, cycleB, self] = await insertCompletedCards(
    ctx,
    userId,
    [
      card(scenario, 1, "Hub with 60 backlinks"),
      card(scenario, 2, "Crowded card with 120 backlinks"),
      card(scenario, 3, "Cycle A"),
      card(scenario, 4, "Cycle B"),
      card(scenario, 5, "Links to itself"),
    ],
    { ignoreCardLimit: true }
  );
  if (!(hub && crowded && cycleA && cycleB && self)) {
    return 0;
  }
  const deleted = await deletedCardId(ctx, userId);
  const titles = [
    LONG_TITLE,
    "🌱 Seedlings and 🌸 flowers",
    "הערות על הגינה",
    "庭の計画について",
  ];
  const sources = await insertCompletedCards(
    ctx,
    userId,
    [
      ...Array.from({ length: 60 }, (_, index) =>
        card(
          scenario,
          10 + index,
          `${titles[index] ?? `Source ${index + 1}`}\n\nSee ${link("Hub", hub)}.`,
          sourceExtra(index)
        )
      ),
      ...Array.from({ length: 120 }, (_, index) =>
        card(
          scenario,
          100 + index,
          `Crowd ${index + 1}\n\n${link("Crowded card", crowded)}`
        )
      ),
    ],
    { ignoreCardLimit: true }
  );
  await setContent(ctx, userId, cycleA, `Cycle A ${link("Cycle B", cycleB)}`);
  await setContent(ctx, userId, cycleB, `Cycle B ${link("Cycle A", cycleA)}`);
  await setContent(
    ctx,
    userId,
    self,
    `Links to itself ${link("Me", self)}, a deleted card ${link("Gone", deleted)} and someone else's ${link("Theirs", UNKNOWN_ID)}`
  );
  return 1 + 5 + sources.length;
};

export const CARD_LINK_SCENARIO_DESCRIPTIONS: Record<CardLinkScenario, string> =
  {
    "card-links":
      "Notes with [[…]] links: a link to itself, to a card in Trash, a deleted card and an unknown id; a target renamed after linking; a 300-character, RTL, CJK and emoji target; a cycle A→B→C→A; tokens in code and malformed ones; and notes with 500 and 501 links (120 real targets, the rest missing). Search `#scenario-card-links`.",
    backlinks:
      "A hub with 60 backlinks (one archived, one in Trash, 300-character, emoji, RTL and CJK source titles), a card with 120 backlinks for API truncation, a cycle A→B→A, and a note linking to itself, a deleted card and an unknown id. Search `#scenario-backlinks`.",
  };

/** Seeds a link pack once; the marker link card says it already ran. */
export const seedCardLinkScenario = async (
  ctx: MutationCtx,
  userId: string,
  scenario: CardLinkScenario
) => {
  if (await alreadySeeded(ctx, userId, scenario)) {
    return { cards: 0, status: "already_seeded" as const };
  }
  const cards =
    scenario === "card-links"
      ? await seedCardLinks(ctx, userId)
      : await seedBacklinks(ctx, userId);
  return { cards, status: "seeded" as const };
};
