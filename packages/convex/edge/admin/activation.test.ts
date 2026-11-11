/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { insertTestCard } from "../../__tests__/helpers/cards.test-utils";
import { internal } from "../../_generated/api";
import { DAY_MS } from "../../admin/dates";
import { newBackend } from "../helpers.testUtils";

// The admin overview and the metrics cohorts count activated users the same
// way: five of their own cards (onboarding cards don't count) in a first
// week that has ended.

const NOW = Date.UTC(2026, 10, 6);
const SIGNED_UP = NOW - 10 * DAY_MS;

const seed = async (
  t: ReturnType<typeof backend>,
  userId: string,
  createdAt: number,
  own: number,
  onboarding: number
) => {
  await t.run(async (ctx) => {
    for (let index = 0; index < own + onboarding; index += 1) {
      const at = createdAt + DAY_MS + index;
      await insertTestCard(ctx, {
        content: `${userId} ${index}`,
        createdAt: at,
        type: "text",
        updatedAt: at,
        userId,
        ...(index >= own ? { onboarding: "welcome" } : {}),
      });
    }
  });
  return { createdAt, teakUserId: userId };
};

const backend = () => newBackend();

describe("activated users", () => {
  test("both admin views count five own cards in an ended first week", async () => {
    const t = backend();
    const users = [
      await seed(t, "activated", SIGNED_UP, 5, 0),
      await seed(t, "onboarding-padded", SIGNED_UP, 4, 3),
      await seed(t, "week-not-over", NOW - 3 * DAY_MS, 6, 0),
    ];

    expect(
      await t.query(internal.admin.countActivatedUsers, { now: NOW, users })
    ).toBe(1);
    const cohort = await t.query(internal.adminMetrics.cohortActivity, {
      now: NOW,
      users,
      weeks: 2,
    });
    expect(
      Object.fromEntries(
        cohort.map((row: { activated: boolean; teakUserId: string }) => [
          row.teakUserId,
          row.activated,
        ])
      )
    ).toEqual({
      activated: true,
      "onboarding-padded": false,
      "week-not-over": false,
    });
  });
});
