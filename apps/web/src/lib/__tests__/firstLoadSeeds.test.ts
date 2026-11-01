import { beforeEach, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";

mock.module("server-only", () => ({}));
process.env.NEXT_PUBLIC_CONVEX_URL ??= "https://fixture.convex.cloud";

type Answer = (args: Record<string, unknown>) => Promise<unknown>;
const answers = new Map<string, Answer>();
const tokens: (string | undefined)[] = [];
mock.module("convex/nextjs", () => ({
  fetchQuery: (
    query: Parameters<typeof getFunctionName>[0],
    args: Record<string, unknown>,
    options: { token?: string }
  ) => {
    tokens.push(options.token);
    const answer = answers.get(getFunctionName(query));
    return answer ? answer(args) : Promise.resolve(null);
  },
}));

const { fetchFirstLoadSeeds } = await import("../firstLoadSeeds");

const never = () => new Promise<never>(() => undefined);
const names = (seeds: { name: string }[]) => seeds.map(({ name }) => name);

beforeEach(() => {
  answers.clear();
  tokens.length = 0;
});

test("fetches the page's first queries with the visitor's token", async () => {
  answers.set("auth:getAuthUser", async () => ({ _id: "teak_A" }));
  const seeds = await fetchFirstLoadSeeds("https://app.example/tags", "tok");

  expect(names(seeds).sort()).toEqual([
    "auth:getAuthUser",
    "auth:getCardCreationStatus",
    "folders:listFolders",
    "tags:listTagSummary",
  ]);
  expect(seeds.find(({ name }) => name === "auth:getAuthUser")?.value).toEqual({
    _id: "teak_A",
  });
  expect(new Set(tokens)).toEqual(new Set(["tok"]));
});

test("leaves out queries that fail or miss the time budget", async () => {
  answers.set("auth:getCardCreationStatus", () =>
    Promise.reject(new Error("down"))
  );
  answers.set("tags:listTagSummary", never);
  const started = Date.now();
  const seeds = await fetchFirstLoadSeeds("https://app.example/tags", "t", 50);

  expect(Date.now() - started).toBeLessThan(1000);
  expect(names(seeds).sort()).toEqual([
    "auth:getAuthUser",
    "folders:listFolders",
  ]);
});

test("fetches a manual folder's first page once the folders name its kind", async () => {
  answers.set("folders:listFolders", async () => [
    { _id: "manual123", kind: "manual" },
  ]);
  const seeds = await fetchFirstLoadSeeds(
    "https://app.example/f/manual123",
    "t"
  );
  const cards = seeds.find(({ name }) => name === "cards:searchCardsPaginated");
  expect(cards?.args).toMatchObject({ folderId: "manual123" });
});

test("skips a smart folder's cards, which depend on its saved search", async () => {
  answers.set("folders:listFolders", async () => [
    { _id: "smart123", kind: "smart" },
  ]);
  const seeds = await fetchFirstLoadSeeds(
    "https://app.example/f/smart123",
    "t"
  );
  expect(names(seeds)).not.toContain("cards:searchCardsPaginated");
  expect(names(seeds)).toContain("folders:getFolder");
});

test("leaves a date filter's cards to the browser, whose time zone sets the range", async () => {
  const seeds = await fetchFirstLoadSeeds(
    "https://app.example/?date=this%20week",
    "t"
  );
  expect(names(seeds)).not.toContain("cards:searchCardsPaginated");
  expect(names(seeds)).toContain("auth:getAuthUser");
});
