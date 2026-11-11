import polarTest from "@convex-dev/polar/test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import { FREE_TIER_LIMIT } from "../../shared/constants";
import { newBackend, signIn } from "../helpers.testUtils";

const OWNER = "owner";

const insertCards = async (ctx: MutationCtx, count: number) => {
  for (let index = 0; index < count; index += 1) {
    await ctx.db.insert("cards", {
      userId: OWNER,
      content: `Card ${index}`,
      type: "text",
      createdAt: index,
      updatedAt: index,
    });
  }
};

const setup = async (seed: (ctx: MutationCtx) => Promise<void>) => {
  const t = newBackend();
  polarTest.register(t);
  const owner = await signIn(t, OWNER);
  await t.run(seed);
  return { owner, t };
};

const canCreate = async (
  owner: Awaited<ReturnType<typeof setup>>["owner"]
) => ({
  currentUser: (await owner.query(api.auth.getCurrentUser, {}))?.canCreateCard,
  creationStatus: (await owner.query(api.auth.getCardCreationStatus, {}))
    ?.canCreateCard,
});

const createOne = (owner: Awaited<ReturnType<typeof setup>>["owner"]) =>
  owner.mutation(api.cards.createCard, { content: "One more" });

describe("whether a free account can save another card", () => {
  test.each([
    [FREE_TIER_LIMIT - 1, true],
    [FREE_TIER_LIMIT, false],
  ])(
    "with %i cards saved, canCreateCard is %p, as a save finds",
    async (cards, allowed) => {
      const { owner } = await setup((ctx) => insertCards(ctx, cards));

      expect(await canCreate(owner)).toEqual({
        currentUser: allowed,
        creationStatus: allowed,
      });
      if (allowed) {
        await expect(createOne(owner)).resolves.toBeDefined();
      } else {
        await expect(createOne(owner)).rejects.toMatchObject({
          data: expect.objectContaining({ code: "CARD_LIMIT_REACHED" }),
        });
      }
    }
  );

  // A count a bounded recount left inexact: saving refuses until the account
  // is recounted, however many cards it really holds, so the app must not
  // offer the save.
  test("says no while the card count is inexact, as a save does", async () => {
    const { owner } = await setup(async (ctx) => {
      await insertCards(ctx, FREE_TIER_LIMIT - 20);
      await ctx.db.insert("userCardUsage", {
        userId: OWNER,
        activeCardCount: FREE_TIER_LIMIT - 50,
        isCountExact: false,
        isSaturated: false,
        updatedAt: 1,
      });
    });

    await expect(createOne(owner)).rejects.toMatchObject({
      data: expect.objectContaining({ code: "CARD_LIMIT_REACHED" }),
    });
    expect(await canCreate(owner)).toEqual({
      currentUser: false,
      creationStatus: false,
    });
  });

  test("/v1/me reports the same count and limit", async () => {
    const { t } = await setup((ctx) => insertCards(ctx, 3));

    expect(
      await t.query(internal.publicApiMe.profileForUser, {
        teakUserId: OWNER,
        includeUsage: true,
      })
    ).toMatchObject({ cardCount: 3, cardLimit: FREE_TIER_LIMIT, plan: "free" });
  });
});
