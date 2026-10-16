import { describe, expect, test } from "bun:test";
import {
  type BucketConfig,
  type LifecycleRule,
  lifecycleRulesToPut,
  type NotificationRule,
  planLifecycle,
  planNotifications,
  R2_BUCKETS,
  R2_RULE_PREFIX,
  syncR2Buckets,
} from "./cloudflare-r2-lifecycle";

const DAY = 86_400;

const expireRule = (
  name: string,
  prefix: string,
  days: number
): LifecycleRule => ({
  conditions: { prefix },
  deleteObjectsTransition: { condition: { maxAge: days * DAY, type: "Age" } },
  enabled: true,
  id: `${R2_RULE_PREFIX}${name}`,
});

const notification = (name: string, prefix: string): NotificationRule => ({
  actions: ["PutObject", "CompleteMultipartUpload", "CopyObject"],
  description: `${R2_RULE_PREFIX}${name}`,
  prefix,
  suffix: "",
});

describe("lifecycle planning", () => {
  test("creates missing rules, updates changed ones and deletes retired ones", () => {
    const plan = planLifecycle(
      [
        expireRule("same", "exports/", 8),
        expireRule("changed", "exports/", 30),
        expireRule("retired", "old/", 1),
      ],
      [
        expireRule("same", "exports/", 8),
        expireRule("changed", "exports/", 8),
        expireRule("new", "dev/exports/", 8),
      ]
    );
    expect(plan.create.map((rule) => rule.id)).toEqual(["teak-new"]);
    expect(plan.update.map(({ rule }) => rule.id)).toEqual(["teak-changed"]);
    expect(plan.remove.map((rule) => rule.id)).toEqual(["teak-retired"]);
    expect(plan.unchanged.map((rule) => rule.id)).toEqual(["teak-same"]);
  });

  test("never plans changes to rules it does not own, and keeps them on PUT", () => {
    const foreign: LifecycleRule = {
      abortMultipartUploadsTransition: {
        condition: { maxAge: 7 * DAY, type: "Age" },
      },
      conditions: { prefix: "" },
      enabled: true,
      id: "Default Multipart Abort Rule",
    };
    const plan = planLifecycle([foreign, expireRule("old", "x/", 1)], []);
    expect(plan.remove.map((rule) => rule.id)).toEqual(["teak-old"]);
    expect(
      lifecycleRulesToPut(
        [foreign, expireRule("old", "x/", 1)],
        [expireRule("new", "y/", 2)]
      ).map((rule) => rule.id)
    ).toEqual(["Default Multipart Abort Rule", "teak-new"]);
  });

  test("a disabled rule counts as drift", () => {
    const plan = planLifecycle(
      [{ ...expireRule("exports", "exports/", 8), enabled: false }],
      [expireRule("exports", "exports/", 8)]
    );
    expect(plan.update).toHaveLength(1);
  });
});

describe("notification planning", () => {
  test("matches rules by description and owns only teak- ones", () => {
    const plan = planNotifications(
      [
        { ...notification("same", "users/"), ruleId: "r1" },
        { ...notification("moved", "users/"), ruleId: "r2" },
        { ...notification("retired", "old/"), ruleId: "r3" },
        { actions: ["PutObject"], prefix: "logs/", ruleId: "dashboard" },
      ],
      [
        notification("same", "users/"),
        notification("moved", "dev/users/"),
        notification("new", "x/"),
      ]
    );
    expect(plan.create.map((rule) => rule.description)).toEqual(["teak-new"]);
    expect(plan.update.map(({ live }) => live.ruleId)).toEqual(["r2"]);
    expect(plan.remove.map((rule) => rule.ruleId)).toEqual(["r3"]);
    expect(plan.unchanged.map((rule) => rule.description)).toEqual([
      "teak-same",
    ]);
  });

  test("the same actions in another order are not drift", () => {
    const plan = planNotifications(
      [
        {
          ...notification("same", "users/"),
          actions: ["CopyObject", "PutObject", "CompleteMultipartUpload"],
          ruleId: "r1",
        },
      ],
      [notification("same", "users/")]
    );
    expect(plan.unchanged).toHaveLength(1);
  });
});

describe("desired configuration", () => {
  test("every bucket expires exports after 8 days and aborts stale uploads after a day", () => {
    for (const config of Object.values(R2_BUCKETS)) {
      const expiries = config.lifecycle.flatMap((rule) =>
        rule.deleteObjectsTransition
          ? [
              [
                rule.conditions.prefix,
                rule.deleteObjectsTransition.condition.maxAge,
              ],
            ]
          : []
      );
      expect(expiries).toContainEqual(["dev/exports/", 8 * DAY]);
      expect(
        config.lifecycle.find((rule) => rule.abortMultipartUploadsTransition)
          ?.abortMultipartUploadsTransition?.condition.maxAge
      ).toBe(DAY);
      expect(
        config.lifecycle.every((rule) => rule.id.startsWith(R2_RULE_PREFIX))
      ).toBe(true);
    }
    expect(
      R2_BUCKETS["teak-files-prod"]?.lifecycle.map(
        (rule) => rule.conditions.prefix
      )
    ).toContain("exports/");
  });
});

describe("sync", () => {
  const bucket: Record<string, BucketConfig> = {
    "bucket-a": {
      lifecycle: [expireRule("exports", "exports/", 8)],
      notifications: { "queue-a": [notification("writes", "users/")] },
    },
  };

  const fakeApi = (live: {
    lifecycle: LifecycleRule[];
    notifications: unknown;
  }) => {
    const writes: Array<{ body: unknown; method: string; path: string }> = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(
        "https://api.cloudflare.com/client/v4",
        ""
      );
      const method = init?.method ?? "GET";
      const ok = (result: unknown) =>
        Promise.resolve(Response.json({ result, success: true }));
      if (method !== "GET") {
        writes.push({ body: JSON.parse(String(init?.body)), method, path });
        return ok(null);
      }
      if (path.endsWith("/lifecycle")) {
        return ok({ rules: live.lifecycle });
      }
      if (path.includes("/queues?name=")) {
        return ok([{ queue_id: "queue-id-a" }]);
      }
      return ok(live.notifications);
    }) as typeof fetch;
    return { fetcher, writes };
  };

  test("a dry run writes nothing", async () => {
    const api = fakeApi({ lifecycle: [], notifications: { queues: [] } });
    const [plan] = await syncR2Buckets({
      accountId: "acct",
      apply: false,
      buckets: bucket,
      fetcher: api.fetcher,
      log: () => undefined,
      token: "t",
    });
    expect(plan?.lifecycle.create).toHaveLength(1);
    expect(api.writes).toEqual([]);
  });

  test("apply puts the merged lifecycle and replaces drifted notifications", async () => {
    const api = fakeApi({
      lifecycle: [
        { ...expireRule("exports", "exports/", 8), id: "mine-by-hand" },
      ],
      notifications: {
        queues: [
          {
            queueId: "queue-id-a",
            queueName: "queue-a",
            rules: [
              { ...notification("writes", "everything/"), ruleId: "old-rule" },
            ],
          },
        ],
      },
    });
    await syncR2Buckets({
      accountId: "acct",
      apply: true,
      buckets: bucket,
      fetcher: api.fetcher,
      log: () => undefined,
      token: "t",
    });
    expect(api.writes).toEqual([
      {
        body: {
          rules: [
            { ...expireRule("exports", "exports/", 8), id: "mine-by-hand" },
            expireRule("exports", "exports/", 8),
          ],
        },
        method: "PUT",
        path: "/accounts/acct/r2/buckets/bucket-a/lifecycle",
      },
      {
        body: { ruleIds: ["old-rule"] },
        method: "DELETE",
        path: "/accounts/acct/event_notifications/r2/bucket-a/configuration/queues/queue-id-a",
      },
      {
        body: { rules: [notification("writes", "users/")] },
        method: "PUT",
        path: "/accounts/acct/event_notifications/r2/bucket-a/configuration/queues/queue-id-a",
      },
    ]);
  });
});
