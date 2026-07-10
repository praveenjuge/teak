import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  cleanupE2EAccounts,
  isConfiguredE2EEmail,
  isE2ECleanupResult,
  summarizeE2ECleanup,
} from "./e2e-cleanup";
import { env } from "./env";
import {
  deleteMailpitMessages,
  type MailpitMessage,
  messageIdsForRecipients,
} from "./mailpit";

const originalFetch = globalThis.fetch;
const originalCleanupToken = env.cleanupToken;
const originalConvexSiteUrl = env.convexSiteUrl;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.cleanupToken = originalCleanupToken;
  env.convexSiteUrl = originalConvexSiteUrl;
});

describe("production E2E cleanup helpers", () => {
  test("filters exact configured recipients and message IDs", () => {
    const messages: MailpitMessage[] = [
      {
        ID: "one",
        Subject: "verify",
        To: [{ Address: "e2e-one@tests.example.com" }],
      },
      {
        ID: "two",
        Subject: "verify",
        To: [{ Address: "person@example.com" }],
      },
    ];
    expect(
      messageIdsForRecipients(messages, ["e2e-one@tests.example.com"])
    ).toEqual(["one"]);
    expect(
      isConfiguredE2EEmail("e2e-one@tests.example.com", "tests.example.com")
    ).toBe(true);
    expect(
      isConfiguredE2EEmail("person@tests.example.com", "tests.example.com")
    ).toBe(false);
  });

  test("bulk deletes known message IDs once", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await deleteMailpitMessages(["one", "one", "two"])).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toEndWith("/api/v1/messages");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({ IDs: ["one", "two"] });
  });

  test("summarizes ineffective cleanup states", () => {
    const result = {
      alreadyDeleted: ["one"],
      deleted: ["two"],
      failures: [{ email: "three", reason: "failed" }],
      ignoredOutOfRange: ["four"],
      remainingEligible: true,
    };
    expect(isE2ECleanupResult(result)).toBe(true);
    expect(isE2ECleanupResult({ ...result, deleted: "two" })).toBe(false);
    expect(summarizeE2ECleanup(result)).toBe(
      "deleted=1 alreadyDeleted=1 failed=1 outOfRange=1 remaining=true"
    );
  });

  test("rejects malformed server responses without hiding status", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    globalThis.fetch = mock(async () =>
      Response.json(
        { code: "UNAUTHORIZED", message: "Unauthorized" },
        { status: 401 }
      )
    ) as unknown as typeof fetch;

    await expect(cleanupE2EAccounts()).rejects.toThrow(
      "invalid response (401)"
    );
  });
});
