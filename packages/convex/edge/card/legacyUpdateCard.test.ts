import { expect, test } from "vitest";
import { seedWorkosOwner } from "../../__tests__/helpers/workosOwner.test-utils";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { newBackend, workosIdentity } from "../helpers.testUtils";

const OWNER = "legacy-update-owner";

async function setup(seed: Partial<Doc<"cards">> = {}) {
  const t = newBackend();
  const workosUserId = await seedWorkosOwner(t, OWNER);
  const owner = t.withIdentity(workosIdentity(workosUserId, OWNER));
  const now = Date.now();
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: OWNER,
      type: "link",
      content: "",
      url: "https://old.example/page",
      pageArchive: {
        storageKey: "users/x/cards/c/page-archive/old.html",
        bytes: 10,
        kind: "full",
        source: "server",
        capturedAt: now,
        sourceUrl: "https://old.example/page",
      },
      createdAt: now,
      updatedAt: now,
      ...seed,
    })
  );
  return { t, owner, cardId };
}

test("updateCard won't move a highlighted link to another URL", async () => {
  const { t, owner, cardId } = await setup({ hasHighlights: true });
  await expect(
    owner.mutation(api.cards.updateCard, {
      id: cardId,
      url: "https://new.example/page",
    })
  ).rejects.toThrow("Remove this link's highlights");
  const card = await t.run((ctx) => ctx.db.get("cards", cardId));
  expect(card?.url).toBe("https://old.example/page");
});

test("updateCard drops the old page's saved copy when the URL changes", async () => {
  const { t, owner, cardId } = await setup();
  await owner.mutation(api.cards.updateCard, {
    id: cardId,
    url: "https://new.example/page",
  });
  const card = await t.run((ctx) => ctx.db.get("cards", cardId));
  expect(card?.url).toBe("https://new.example/page");
  expect(card?.pageArchive).toBeUndefined();
  expect(card?.processingStatus?.archive?.status).toBe("pending");
});
