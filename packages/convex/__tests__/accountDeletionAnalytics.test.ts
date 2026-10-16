import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { deletePostHogPerson } from "../accountDeletionAnalytics";
import { deletionFailureReason } from "../accountDeletionStages";

const DELETION_KEY = "phx_test_person_deletion_key";
const ENV_KEYS = [
  "POSTHOG_PROJECT_TOKEN",
  "POSTHOG_PERSON_DELETION_API_KEY",
] as const;
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

interface BulkDeleteRequest {
  authorization: string | null;
  body: Record<string, unknown>;
  url: string;
}

let requests: BulkDeleteRequest[];

const stubPostHog = (
  persons: Set<string>,
  answer?: (body: Record<string, unknown>) => Response
) => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("Authorization"),
      body,
    });
    if (answer) {
      return Promise.resolve(answer(body));
    }
    const ids = body.distinct_ids as string[];
    const found = ids.filter((id) => persons.delete(id)).length;
    return Promise.resolve(
      Response.json(
        {
          persons_found: found,
          persons_deleted: 0,
          persons_queued_for_deletion: found,
          events_queued_for_deletion: found > 0,
          recordings_queued_for_deletion: found > 0,
          deletion_errors: [],
        },
        { status: 202 }
      )
    );
  }) as typeof fetch;
};

beforeEach(() => {
  requests = [];
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
  process.env.POSTHOG_PERSON_DELETION_API_KEY = DELETION_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

const rejection = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
};

describe("deletePostHogPerson", () => {
  test("deletes the owner's person, events and recordings by their Teak id", async () => {
    const persons = new Set(["teak_owner", "teak_someone_else"]);
    stubPostHog(persons);

    expect(await deletePostHogPerson("teak_owner")).toBe("deleted");

    expect(persons).toEqual(new Set(["teak_someone_else"]));
    expect(requests).toEqual([
      {
        url: "https://us.posthog.com/api/projects/660923/persons/bulk_delete/",
        authorization: `Bearer ${DELETION_KEY}`,
        body: {
          distinct_ids: ["teak_owner"],
          delete_events: true,
          delete_recordings: true,
        },
      },
    ]);
  });

  test("a retry after the person is gone succeeds again", async () => {
    const persons = new Set(["teak_owner"]);
    stubPostHog(persons);

    expect(await deletePostHogPerson("teak_owner")).toBe("deleted");
    expect(await deletePostHogPerson("teak_owner")).toBe("deleted");
    expect(persons.size).toBe(0);
  });

  test("sends nothing from a deployment that sends no analytics", async () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    delete process.env.POSTHOG_PERSON_DELETION_API_KEY;
    stubPostHog(new Set(["teak_owner"]));

    expect(await deletePostHogPerson("teak_owner")).toBe("skipped");
    expect(requests).toEqual([]);
  });

  test("fails for a retry when production has no deletion key", async () => {
    delete process.env.POSTHOG_PERSON_DELETION_API_KEY;
    stubPostHog(new Set(["teak_owner"]));

    await expect(deletePostHogPerson("teak_owner")).rejects.toThrow(
      "deletion_posthog_unconfigured"
    );
    expect(requests).toEqual([]);
  });

  test.each([401, 429, 500, 503])(
    "fails for a retry when PostHog answers %i, without leaking the key",
    async (status: number) => {
      stubPostHog(new Set(), () =>
        Response.json({ detail: `rejected ${DELETION_KEY}` }, { status })
      );

      const error = await rejection(() => deletePostHogPerson("teak_owner"));
      expect(error.message).toBe(`deletion_posthog_status_${status}`);
      expect(error.message).not.toContain(DELETION_KEY);
    }
  );

  test("fails for a retry when PostHog is unreachable", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new Error(`connect ECONNREFUSED with ${DELETION_KEY}`)
      )) as unknown as typeof fetch;

    const error = await rejection(() => deletePostHogPerson("teak_owner"));
    expect(error.message).toBe("deletion_posthog_unreachable");
  });

  test("fails for a retry when PostHog could not delete the person", async () => {
    stubPostHog(new Set(), () =>
      Response.json(
        {
          persons_found: 1,
          persons_deleted: 0,
          deletion_errors: [{ person_uuid: "uuid", step: "delete_person" }],
        },
        { status: 202 }
      )
    );

    await expect(deletePostHogPerson("teak_owner")).rejects.toThrow(
      "deletion_posthog_incomplete"
    );
  });

  test("accepts failures PostHog reports only after the person is deleted", async () => {
    stubPostHog(new Set(), () =>
      Response.json(
        {
          persons_found: 1,
          persons_deleted: 1,
          deletion_errors: [
            { person_uuid: "uuid", step: "log_activity" },
            { person_uuid: "uuid", step: "publish_clickhouse_tombstone" },
          ],
        },
        { status: 202 }
      )
    );

    expect(await deletePostHogPerson("teak_owner")).toBe("deleted");
  });

  test("the workflow records its failures as analytics deletion failures", async () => {
    stubPostHog(new Set(), () => new Response(null, { status: 502 }));

    const error = await rejection(() => deletePostHogPerson("teak_owner"));
    expect(deletionFailureReason(error)).toBe("analytics_deletion_failed");
  });
});
