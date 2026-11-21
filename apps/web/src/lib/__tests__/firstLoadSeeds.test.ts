import { afterAll, beforeEach, expect, test } from "bun:test";

process.env.VITE_PUBLIC_CONVEX_URL ??= "https://fixture.convex.cloud";
const queryUrl = new URL("/api/query", process.env.VITE_PUBLIC_CONVEX_URL).href;

type Answer = (args: Record<string, unknown>) => Promise<unknown>;
const answers = new Map<string, Answer>();
const tokens: (string | null)[] = [];
// Convex's HTTP query endpoint is the only network this may reach.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url !== queryUrl) {
    throw new Error(`Must not reach ${url}`);
  }
  const { path, args } = JSON.parse(String(init?.body)) as {
    path: string;
    args: Record<string, unknown>[];
  };
  tokens.push(new Headers(init?.headers).get("authorization"));
  const answer = answers.get(path);
  try {
    const value = answer ? await answer(args[0] ?? {}) : null;
    return Response.json({ status: "success", value, logLines: [] });
  } catch (error) {
    return Response.json({
      status: "error",
      errorMessage: (error as Error).message,
      logLines: [],
    });
  }
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

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
  expect(new Set(tokens)).toEqual(new Set(["Bearer tok"]));
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
