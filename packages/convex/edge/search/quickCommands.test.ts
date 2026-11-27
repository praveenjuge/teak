import { expect, test } from "vitest";
import { insertTestCard } from "../../__tests__/helpers/cards.test-utils";
import { api } from "../../_generated/api";
import { newBackend, signIn } from "../helpers.testUtils";

test("a quick command filtered by type finds older matches past the limit", async () => {
  const t = newBackend();
  const owner = await signIn(t, "owner");
  await t.run(async (ctx) => {
    const card = (type: "text" | "image", savedAt: number) =>
      insertTestCard(ctx, {
        userId: "owner",
        type,
        content: `${type} ${savedAt}`,
        createdAt: savedAt,
        updatedAt: savedAt,
        savedAt,
        isDeleted: true,
        deletedAt: savedAt,
      });
    await card("image", 1000);
    for (let index = 1; index <= 5; index += 1) {
      await card("text", 1000 + index);
    }
  });

  const found = await owner.query(api.cards.searchCards, {
    searchQuery: "trash",
    types: ["image"],
    limit: 3,
  });

  expect(found.map((card) => card.content)).toEqual(["image 1000"]);
});
