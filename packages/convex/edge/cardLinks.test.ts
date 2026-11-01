import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { TITLE_LOOKUP_LIMIT } from "../card/cardLinks";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import {
  type CardFieldEdit,
  updateCardFieldForUserHandler,
  updateCardFieldsForUserHandler,
} from "../card/updateCard";
import schema from "../schema";
import type { TeakUserId } from "../securitySessions";
import { formatCardLinkToken } from "../shared/cardLinks";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Partial<Omit<Doc<"cards">, "_id" | "_creationTime">>;

const link = (title: string, id: string) => formatCardLinkToken(title, id);

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const ownerWorkosId = await seedWorkosOwner(t, "owner");
  const strangerWorkosId = await seedWorkosOwner(t, "stranger");
  const identity = (subject: string, externalId: string) =>
    t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject,
      sid: `session_${externalId}`,
      email_verified: true,
      external_id: externalId,
    });
  const owner = identity(ownerWorkosId, "owner");
  const stranger = identity(strangerWorkosId, "stranger");
  let createdAt = 1000;

  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  const insert = async (seed: CardSeed = {}) => {
    createdAt += 1;
    const at = createdAt;
    const id = await t.run(async (ctx) => {
      const cardId = await ctx.db.insert("cards", {
        content: "",
        createdAt: at,
        shuffleKey: 0.5,
        type: "text",
        updatedAt: at,
        userId: "owner",
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, cardId);
      return cardId;
    });
    await runScheduled();
    return id;
  };

  const edit = async (
    cardId: Id<"cards">,
    edits: CardFieldEdit[],
    userId = "owner"
  ) => {
    await t.run((ctx) =>
      updateCardFieldsForUserHandler(
        ctx,
        { cardId, edits, userId: userId as TeakUserId },
        { deferPipelineSchedule: true }
      )
    );
    await runScheduled();
  };

  const move = async (cardId: Id<"cards">, field: "delete" | "restore") => {
    await t.run((ctx) =>
      updateCardFieldForUserHandler(ctx, {
        cardId,
        field,
        userId: "owner" as TeakUserId,
      })
    );
    await runScheduled();
  };

  const setContent = (cardId: Id<"cards">, content: string) =>
    edit(cardId, [{ field: "content", value: content }]);

  const rows = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("cardLinks").take(2000)).map((row) => ({
        from: row.fromCardId,
        to: row.toCardId,
        userId: row.userId,
      }))
    );

  return {
    edit,
    insert,
    move,
    owner,
    rows,
    runScheduled,
    setContent,
    stranger,
    t,
  };
};

describe("link rows", () => {
  test("a content save rebuilds the rows: own cards only, no self-links, no duplicates", async () => {
    const { insert, rows, setContent } = await setup();
    const note = await insert();
    const a = await insert({ content: "A" });
    const b = await insert({ content: "B" });
    const foreign = await insert({ content: "theirs", userId: "stranger" });

    await setContent(
      note,
      [
        link("A", a),
        link("A again", a),
        link("Me", note),
        link("Theirs", foreign),
        link("Bad", "aaaaaaaaaaaaaaaa"),
        `\`${link("Code", b)}\``,
      ].join(" ")
    );
    expect(await rows()).toEqual([{ from: note, to: a, userId: "owner" }]);

    await setContent(note, `${link("B", b)}`);
    expect(await rows()).toEqual([{ from: note, to: b, userId: "owner" }]);

    await setContent(note, "No links now");
    expect(await rows()).toEqual([]);
  });

  test("a malformed or foreign-table id syncs nothing and doesn't fail the save", async () => {
    const { insert, rows, setContent, t } = await setup();
    const note = await insert();
    const folderId = await t.run(async (ctx) => {
      const document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", note))
        .unique();
      if (!document) {
        throw new Error("expected a search document");
      }
      return document._id;
    });
    await setContent(
      note,
      `${link("Folder", folderId)} ${link("Junk", "zzzzzzzzzzzzzzzzzzzz")}`
    );
    expect(await rows()).toEqual([]);
    expect(
      (await t.run((ctx) => ctx.db.get("cards", note)))?.content
    ).toContain("teak:zzzz");
  });

  test("a new card with links gets rows", async () => {
    const { insert, rows } = await setup();
    const a = await insert({ content: "A" });
    const note = await insert({ content: link("A", a) });
    expect(await rows()).toEqual([{ from: note, to: a, userId: "owner" }]);
  });

  test("a card that isn't a note never gets rows", async () => {
    const { insert, rows } = await setup();
    const a = await insert({ content: "A" });
    await insert({ content: link("A", a), type: "quote" });
    expect(await rows()).toEqual([]);
  });

  test("indexes at most 500 targets", async () => {
    const { insert, rows, setContent, t } = await setup();
    const note = await insert();
    const targets = await t.run(async (ctx) => {
      const ids: Id<"cards">[] = [];
      for (let index = 0; index < 501; index++) {
        ids.push(
          await ctx.db.insert("cards", {
            content: `T${index}`,
            createdAt: index,
            shuffleKey: 0.5,
            type: "text",
            updatedAt: index,
            userId: "owner",
          })
        );
      }
      return ids;
    });
    await setContent(note, targets.map((id) => link("T", id)).join(" "));
    const stored = await rows();
    expect(stored).toHaveLength(500);
    expect(stored.some((row) => row.to === targets[500])).toBe(false);
  });

  test("edits in a row converge on the last content", async () => {
    const { insert, rows, setContent } = await setup();
    const note = await insert();
    const a = await insert({ content: "A" });
    const b = await insert({ content: "B" });
    for (let index = 0; index < 20; index++) {
      await setContent(note, link(index % 2 ? "B" : "A", index % 2 ? b : a));
    }
    expect(await rows()).toEqual([{ from: note, to: b, userId: "owner" }]);
  });

  test("hard-deleting a card removes its rows in both directions", async () => {
    const { insert, owner, rows, runScheduled, setContent } = await setup();
    const a = await insert({ content: "A" });
    const note = await insert();
    const other = await insert();
    await setContent(note, link("A", a));
    await setContent(other, link("Note", note));
    expect(await rows()).toHaveLength(2);

    await owner.mutation(api.cards.permanentDeleteCard, { id: note });
    await runScheduled();
    expect(await rows()).toEqual([]);
  });

  test("trashing keeps the rows, so a restore brings the link back", async () => {
    const { insert, move, owner, rows, setContent } = await setup();
    const a = await insert({ content: "Target" });
    const note = await insert();
    await setContent(note, link("Target", a));

    await move(a, "delete");
    expect(await rows()).toHaveLength(1);
    expect(
      await owner.query(api.cards.getCardLinkTargets, { cardIds: [a] })
    ).toEqual([{ id: a, missing: true, title: null, type: null }]);

    await move(a, "restore");
    expect(
      await owner.query(api.cards.getCardLinkTargets, { cardIds: [a] })
    ).toEqual([{ id: a, missing: false, title: "Target", type: "text" }]);
  });
});

describe("link targets", () => {
  test("live titles; foreign, unknown and malformed ids are missing", async () => {
    const { insert, owner, stranger } = await setup();
    const mine = await insert({ content: "My note" });
    const titled = await insert({
      content: "Body",
      metadataTitle: "Renamed",
    });
    const theirs = await insert({ content: "Theirs", userId: "stranger" });
    const targets = await owner.query(api.cards.getCardLinkTargets, {
      cardIds: [mine, titled, theirs, "zzzzzzzzzzzzzzzz", mine],
    });
    expect(targets).toEqual([
      { id: mine, missing: false, title: "My note", type: "text" },
      { id: titled, missing: false, title: "Renamed", type: "text" },
      { id: theirs, missing: true, title: null, type: null },
      { id: "zzzzzzzzzzzzzzzz", missing: true, title: null, type: null },
    ]);
    expect(
      (
        await stranger.query(api.cards.getCardLinkTargets, { cardIds: [mine] })
      ).map((target: { missing: boolean }) => target.missing)
    ).toEqual([true]);
  });
});

describe("live titles inside titles", () => {
  test("one query reads at most 100 linked cards; past that, links keep their saved titles", async () => {
    const { owner, t } = await setup();
    const targets = await t.run(async (ctx) => {
      const ids: Id<"cards">[] = [];
      for (let index = 0; index <= TITLE_LOOKUP_LIMIT; index++) {
        const card = (content: string) =>
          ctx.db.insert("cards", {
            content,
            createdAt: index,
            shuffleKey: 0.5,
            type: "text",
            updatedAt: index,
            userId: "owner",
          });
        ids.push(await card(link("Saved", await card("Current"))));
      }
      return ids;
    });
    const titles: (string | null)[] = (
      await owner.query(api.cards.getCardLinkTargets, { cardIds: targets })
    ).map((target: { title: string | null }) => target.title);
    expect(titles.filter((title) => title === "Current")).toHaveLength(
      TITLE_LOOKUP_LIMIT
    );
    expect(titles.filter((title) => title === "Saved")).toHaveLength(1);
  });
});

describe("suggestions", () => {
  test("matches the user's cards, leaving out trash and the card being edited", async () => {
    const { insert, owner } = await setup();
    const current = await insert({ content: "Garden plan current" });
    const match = await insert({ content: "Garden plan for spring" });
    await insert({ content: "Garden plan trashed", isDeleted: true });
    await insert({ content: "Garden plan theirs", userId: "stranger" });
    const results = await owner.query(api.cards.searchCardLinkSuggestions, {
      excludeCardId: current,
      query: "garden",
    });
    expect(results).toEqual([
      { id: match, title: "Garden plan for spring", type: "text" },
    ]);
  });

  test("an archived card is offered when its text matches, but not as a recent card", async () => {
    const { insert, owner } = await setup();
    const archived = await insert({
      content: "Garden archive",
      isArchived: true,
    });
    expect(
      (
        await owner.query(api.cards.searchCardLinkSuggestions, {
          query: "garden",
        })
      ).map((result: { id: string }) => result.id)
    ).toEqual([archived]);
    expect(
      await owner.query(api.cards.searchCardLinkSuggestions, { query: "" })
    ).toEqual([]);
  });

  test("an empty query offers recent cards", async () => {
    const { insert, owner } = await setup();
    const older = await insert({ content: "Older" });
    const newer = await insert({ content: "Newer" });
    const results = await owner.query(api.cards.searchCardLinkSuggestions, {
      query: "",
    });
    expect(results.map((result: { id: string }) => result.id)).toEqual([
      newer,
      older,
    ]);
  });

  test("a hidden card is offered only when the query names its tag", async () => {
    const { insert, owner } = await setup();
    const hidden = await insert({
      content: "Diary entry",
      isHidden: true,
      tags: ["secret"],
    });
    expect(
      await owner.query(api.cards.searchCardLinkSuggestions, {
        query: "diary",
      })
    ).toEqual([]);
    expect(
      await owner.query(api.cards.searchCardLinkSuggestions, { query: "" })
    ).toEqual([]);
    expect(
      (
        await owner.query(api.cards.searchCardLinkSuggestions, {
          query: "diary #secret",
        })
      ).map((result: { id: string }) => result.id)
    ).toEqual([hidden]);
  });

  test("a link resolves to a hidden card the user linked knowingly", async () => {
    const { insert, owner } = await setup();
    const hidden = await insert({
      content: "Diary entry",
      isHidden: true,
      tags: ["secret"],
    });
    expect(
      await owner.query(api.cards.getCardLinkTargets, { cardIds: [hidden] })
    ).toEqual([
      { id: hidden, missing: false, title: "Diary entry", type: "text" },
    ]);
  });
});

describe("backlinks", () => {
  test("the panel lists sources most recently updated first, leaving out trash", async () => {
    const { insert, move, owner, setContent } = await setup();
    const hub = await insert({ content: "Hub" });
    const first = await insert();
    const second = await insert();
    const trashed = await insert();
    await setContent(first, `First ${link("Hub", hub)}`);
    vi.advanceTimersByTime(1000);
    await setContent(second, `Second ${link("Hub", hub)}`);
    await setContent(trashed, `Trashed ${link("Hub", hub)}`);
    await move(trashed, "delete");

    expect(
      await owner.query(api.cards.getCardBacklinks, { cardId: hub })
    ).toEqual({
      backlinks: [
        { id: second, title: "Second Hub", type: "text" },
        { id: first, title: "First Hub", type: "text" },
      ],
      hasMore: false,
    });
  });

  test("a note tagged secret or hidden never shows as a backlink", async () => {
    const { insert, owner, setContent, t } = await setup();
    const hub = await insert({ content: "Hub" });
    const visible = await insert();
    const diary = await insert({ isHidden: true, tags: ["secret"] });
    await setContent(visible, `Plan ${link("Hub", hub)}`);
    await setContent(diary, `Diary ${link("Hub", hub)}`);

    expect(
      await owner.query(api.cards.getCardBacklinks, { cardId: hub })
    ).toEqual({
      backlinks: [{ id: visible, title: "Plan Hub", type: "text" }],
      hasMore: false,
    });
    const fromApi = await t.query(
      internal["card/cardLinks"].getCardLinksForUser,
      {
        cardId: hub,
        userId: "owner",
      }
    );
    expect(fromApi.backlinks.map((card: { id: string }) => card.id)).toEqual([
      visible,
    ]);
  });

  test("shows 50 and says when there are more", async () => {
    const { insert, owner, runScheduled, t } = await setup();
    const hub = await insert({ content: "Hub" });
    await t.run(async (ctx) => {
      for (let index = 0; index < 51; index++) {
        const source = await ctx.db.insert("cards", {
          content: link("Hub", hub),
          createdAt: index,
          shuffleKey: 0.5,
          type: "text",
          updatedAt: index,
          userId: "owner",
        });
        await syncCardSearchDocumentHandler(ctx, source);
      }
    });
    await runScheduled();
    const result = await owner.query(api.cards.getCardBacklinks, {
      cardId: hub,
    });
    expect(result.backlinks).toHaveLength(50);
    expect(result.hasMore).toBe(true);
  });

  test("the API returns 100 links and 100 backlinks and says when there are more", async () => {
    const { insert, runScheduled, setContent, t } = await setup();
    const hub = await insert({ content: "Hub" });
    const targets = await t.run(async (ctx) => {
      const ids: Id<"cards">[] = [];
      for (let index = 0; index < 101; index++) {
        ids.push(
          await ctx.db.insert("cards", {
            content: `T${index}`,
            createdAt: index,
            shuffleKey: 0.5,
            type: "text",
            updatedAt: index,
            userId: "owner",
          })
        );
        const source = await ctx.db.insert("cards", {
          content: link("Hub", hub),
          createdAt: index,
          shuffleKey: 0.5,
          type: "text",
          updatedAt: index,
          userId: "owner",
        });
        await syncCardSearchDocumentHandler(ctx, source);
      }
      return ids;
    });
    await runScheduled();
    await setContent(hub, targets.map((id) => link("T", id)).join(" "));

    const result = await t.query(
      internal["card/cardLinks"].getCardLinksForUser,
      { cardId: hub, userId: "owner" }
    );
    expect(result.links).toHaveLength(100);
    expect(result.links.map((target: { id: string }) => target.id)).toEqual(
      targets.slice(0, 100)
    );
    expect(result.linksTruncated).toBe(true);
    expect(result.backlinks).toHaveLength(100);
    expect(result.backlinksTruncated).toBe(true);
  });

  test("a backlink's title shows the linked card's current title, or the saved one once it's in Trash", async () => {
    const { insert, move, owner, setContent, t } = await setup();
    const hub = await insert({ content: "Garden plan" });
    const source = await insert();
    await setContent(source, `See ${link("Garden plan", hub)}\n\nTomatoes`);
    await setContent(hub, "Garden plan for spring\n\nBy the fence");

    const backlinkTitles = async () => [
      (await owner.query(api.cards.getCardBacklinks, { cardId: hub }))
        .backlinks[0]?.title,
      (
        await t.query(internal["card/cardLinks"].getCardLinksForUser, {
          cardId: hub,
          userId: "owner",
        })
      ).backlinks[0]?.title,
    ];
    expect(await backlinkTitles()).toEqual([
      "See Garden plan for spring",
      "See Garden plan for spring",
    ]);

    await move(hub, "delete");
    expect(await backlinkTitles()).toEqual([
      "See Garden plan",
      "See Garden plan",
    ]);
  });

  test("another user's card shows nothing", async () => {
    const { insert, setContent, stranger } = await setup();
    const hub = await insert({ content: "Hub" });
    const source = await insert();
    await setContent(source, link("Hub", hub));
    expect(
      await stranger.query(api.cards.getCardBacklinks, { cardId: hub })
    ).toEqual({ backlinks: [], hasMore: false });
  });

  test("the API sees links in token order and backlinks, with missing targets", async () => {
    const { insert, setContent, t } = await setup();
    const a = await insert({ content: "A" });
    const note = await insert();
    const source = await insert();
    const theirs = await insert({ content: "T", userId: "stranger" });
    await setContent(
      note,
      `${link("Theirs", theirs)} ${link("A", a)} ${link("Gone", "aaaaaaaaaaaaaaaa")}`
    );
    await setContent(source, `Src ${link("Note", note)}`);

    const result = await t.query(
      internal["card/cardLinks"].getCardLinksForUser,
      {
        cardId: note,
        userId: "owner",
      }
    );
    expect(result).toEqual({
      backlinks: [
        // The link shows the note's current title, not the "Note" it was saved with.
        {
          id: source,
          missing: false,
          title: "Src Theirs A Gone",
          type: "text",
        },
      ],
      backlinksTruncated: false,
      links: [
        { id: theirs, missing: true, title: null, type: null },
        { id: a, missing: false, title: "A", type: "text" },
        { id: "aaaaaaaaaaaaaaaa", missing: true, title: null, type: null },
      ],
      linksTruncated: false,
    });
    expect(
      await t.query(internal["card/cardLinks"].getCardLinksForUser, {
        cardId: note,
        userId: "stranger",
      })
    ).toBeNull();
  });
});
