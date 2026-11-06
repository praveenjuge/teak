import { sha256Hex } from "@teak/files-protocol";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const WORKOS_USER_ID = "user_01TEAKDEVSEED0000000000000";
const NOW = Date.UTC(2026, 9, 20, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "teak_dev",
      identityOrigin: "workos",
      email: "dev@example.org",
      emailVerified: true,
      workosUserId: WORKOS_USER_ID,
    })
  );
  return t;
};

/** Every pack name, read from the error an unknown pack gets. */
const packNames = async () => {
  const t = await setup();
  const error = await t
    .mutation(internal.devSeed.seedScenario, {
      workosUserId: WORKOS_USER_ID,
      scenario: "no-such-pack",
    })
    .catch((caught: unknown) => caught);
  const message = error instanceof Error ? error.message : String(error);
  return [...message.matchAll(/^ {2}([a-z0-9-]+): /gm)].map(
    (match) => match[1]
  );
};

const ID_PATTERN = /\b[a-z0-9]{32}\b/g;

/** The rows a pack wrote, without ids, creation times or random keys. */
const seededRows = (t: Awaited<ReturnType<typeof setup>>) =>
  t.run(async (ctx) => {
    const ids = new Map<string, string>();
    const stable = (value: unknown) =>
      JSON.stringify(value).replace(ID_PATTERN, (id) => {
        if (!ids.has(id)) {
          ids.set(id, `#${ids.size}`);
        }
        return ids.get(id) as string;
      });
    const strip = <T extends { _creationTime: number; _id: string }>(
      row: T,
      drop: readonly string[] = []
    ) => {
      const copy: Record<string, unknown> = { ...row };
      for (const field of ["_id", "_creationTime", ...drop]) {
        delete copy[field];
      }
      return copy;
    };
    const cards = (await ctx.db.query("cards").collect()).map(
      (card: Doc<"cards">) => strip(card, ["shuffleKey"])
    );
    const folders = (await ctx.db.query("folders").collect()).map((folder) =>
      strip(folder)
    );
    const highlights = (await ctx.db.query("highlights").collect()).map((row) =>
      strip(row)
    );
    const settings = (await ctx.db.query("inboundEmailSettings").collect()).map(
      (row) => strip(row)
    );
    const preferences = (await ctx.db.query("userPreferences").collect()).map(
      (row) => strip(row)
    );
    return stable({ cards, folders, highlights, settings, preferences });
  });

test("every dev seed pack seeds the same rows", {
  timeout: 900_000,
}, async () => {
  const names = await packNames();
  expect(names.length).toBeGreaterThan(40);
  const seeded: Record<string, unknown> = {};
  for (const scenario of names) {
    const t = await setup();
    const result = await t
      .mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario,
        page: 0,
      })
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }));
    const rows = await seededRows(t);
    seeded[scenario] = {
      result,
      rows: await sha256Hex(rows),
      size: rows.length,
    };
  }
  expect(seeded).toMatchSnapshot();
});
