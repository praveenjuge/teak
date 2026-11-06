import polarTest from "@convex-dev/polar/test";
import counterTest from "@convex-dev/sharded-counter/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { insertTestCard } from "../__tests__/helpers/cards.test-utils";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { newBackend, workosIdentity } from "./helpers";

const OWNER = "parity-owner";

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://app.teakvault.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const setup = async () => {
  const t = newBackend();
  polarTest.register(t);
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const workosUserId = await seedWorkosOwner(t, OWNER);
  const owner = t.withIdentity(workosIdentity(workosUserId, OWNER));
  const key = await owner.mutation(api.apiKeys.createUserApiKey, {
    name: "Search parity",
  });

  let createdAt = 1000;
  const insert = (seed: Partial<Doc<"cards">> & { content: string }) => {
    createdAt += 1;
    const at = createdAt;
    return t.run((ctx) =>
      insertTestCard(ctx, {
        userId: OWNER,
        type: seed.url ? "link" : "text",
        createdAt: at,
        updatedAt: at,
        ...seed,
      })
    );
  };

  /** What the web app's search lists for a query, newest first. */
  const appSearch = async (searchQuery: string) => {
    const result = await owner.query(api.cards.searchCardsPaginated, {
      searchQuery,
      paginationOpts: { numItems: 50, cursor: null },
    });
    return result.page.map((card: { content: string }) => card.content);
  };

  /** What `GET /v1/cards?q=` lists for the same query. */
  const apiSearch = async (q: string) => {
    const response = await t.fetch(
      `/v1/cards?q=${encodeURIComponent(q)}&mode=keyword&include=content`,
      { headers: { Authorization: `Bearer ${key.key}` } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { content: string }[] };
    return body.items.map((card) => card.content);
  };

  return { appSearch, apiSearch, insert };
};

const film = (url: string) => ({
  linkCategory: { category: "movie" as const, fetchedAt: 1, sourceUrl: url },
});

describe("app search and the public API", () => {
  test("agree that only links are done or still to do", async () => {
    const { appSearch, apiSearch, insert } = await setup();
    const watched = "https://films.example/watched";
    const toWatch = "https://films.example/to-watch";
    await insert({
      content: "Watched film",
      url: watched,
      metadata: film(watched),
      completedAt: 5,
    });
    await insert({
      content: "Film to watch",
      url: toWatch,
      metadata: film(toWatch),
    });
    // A note can come in done from an import, but only links are done.
    await insert({ content: "Imported done note", completedAt: 5 });
    await insert({ content: "Favorite note", isFavorited: true });

    for (const [query, expected] of [
      ["is:done", ["Watched film"]],
      ["is:todo", ["Film to watch"]],
      ["is:done OR is:fav", ["Favorite note", "Watched film"]],
      ["-is:done note", ["Favorite note", "Imported done note"]],
    ] as const) {
      expect((await appSearch(query)).sort()).toEqual([...expected]);
      expect((await apiSearch(query)).sort()).toEqual([...expected]);
    }
  });
});
