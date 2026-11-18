import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "../../_generated/api";
import { newBackend } from "../helpers.testUtils";

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
  const t = newBackend();
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

test("every dev seed pack seeds its first page and reports what it seeded", {
  timeout: 900_000,
}, async () => {
  const names = await packNames();
  expect(names.length).toBeGreaterThan(40);
  const seeded: Record<string, unknown> = {};
  for (const scenario of names) {
    const t = await setup();
    seeded[scenario] = await t
      .mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario,
        page: 0,
      })
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }));
  }
  expect(seeded).toMatchSnapshot();
});
