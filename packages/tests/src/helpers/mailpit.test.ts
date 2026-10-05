import { afterEach, beforeEach, expect, test } from "bun:test";
import { env } from "./env";
import { captureMailpitMessageIds, waitForEmail } from "./mailpit";

const originalFetch = globalThis.fetch;
const originalUrl = env.mailpitUrl;
const originalDomain = env.emailDomain;
const recipient = "e2e-reset@tests.example.com";
const subject = "Reset your password";
const summary = (ID: string, to = recipient) => ({
  ID,
  Subject: subject,
  To: [{ Address: to }],
});
const response = (data: unknown) => Response.json(data);
const trusted = (url: URL) =>
  url.origin === "https://auth.example.com" &&
  url.pathname === "/reset-password";
beforeEach(() => {
  env.mailpitUrl = "http://mailpit.example.com";
  env.emailDomain = "tests.example.com";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  env.mailpitUrl = originalUrl;
  env.emailDomain = originalDomain;
});
// Failure modes: stale matching mail wins; partial recipient match; logo or
// lookalike origin chosen; incomplete baseline; unsafe detail path; failed or
// malformed/oversized response accepted; unbounded network/polling wait.
test("snapshot reads all pages and captures only the exact recipient and subject without changing the mailbox", async () => {
  const first = Array.from({ length: 100 }, (_, i) =>
    summary(`other-${i}`, "other@tests.example.com")
  );
  first[0] = summary("old-reset", recipient.toUpperCase());
  const methods: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    const start = new URL(String(input)).searchParams.get("start");
    return Promise.resolve(
      response({
        messages:
          start === "0"
            ? first
            : [
                summary("older-reset"),
                { ...summary("other-subject"), Subject: "Verify" },
              ],
        messages_count: 102,
      })
    );
  }) as unknown as typeof fetch;
  expect([...(await captureMailpitMessageIds(recipient, subject))]).toEqual([
    "old-reset",
    "older-reset",
  ]);
  expect(methods).toEqual(["GET", "GET"]);
});

test("ignores stale and neighboring-recipient mail and chooses the trusted reset URL after a logo", async () => {
  const detailIds: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/messages")) {
      return Promise.resolve(
        response({
          messages: [
            summary("stale"),
            summary("neighbor", `x${recipient}`),
            summary("fresh"),
          ],
        })
      );
    }
    detailIds.push(path);
    return Promise.resolve(
      response({
        HTML: '<img src="https://assets.example.com/logo.png"><a href="https://auth.example.com.evil.test/reset-password?token=wrong">Fake</a><a href="https://auth.example.com/reset-password?token=fresh&amp;state=expected">Reset</a>',
      })
    );
  }) as unknown as typeof fetch;
  expect(
    await waitForEmail(recipient, subject, {
      excludeMessageIds: new Set(["stale"]),
      linkPredicate: trusted,
    })
  ).toBe("https://auth.example.com/reset-password?token=fresh&state=expected");
  expect(detailIds).toEqual(["/api/v1/message/fresh"]);
});

test("two-argument callers keep their original first-link selection", async () => {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(
      response(
        new URL(String(input)).pathname.endsWith("/messages")
          ? { messages: [summary("fresh")] }
          : {
              HTML: '<a href="https://app.example.com/verify?token=one&amp;state=two">Verify</a>',
            }
      )
    )) as unknown as typeof fetch;
  expect(await waitForEmail(recipient, subject)).toBe(
    "https://app.example.com/verify?token=one&state=two"
  );
});

test("predicate may find actionable text when HTML has only a logo, but rejects userinfo and unrelated links", async () => {
  let text = "https://auth.example.com/reset-password?token=text";
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(
      response(
        new URL(String(input)).pathname.endsWith("/messages")
          ? { messages: [summary("fresh")] }
          : {
              HTML: '<img src="https://assets.example.com/logo.png">',
              Text: text,
            }
      )
    )) as unknown as typeof fetch;
  expect(
    await waitForEmail(recipient, subject, { linkPredicate: trusted })
  ).toBe(text);
  text = "https://user:password@auth.example.com/reset-password?token=wrong";
  await expect(
    waitForEmail(recipient, subject, { linkPredicate: trusted })
  ).rejects.toThrow("no matching link");
});

test.each(["../outside", "id?admin=true", "id/child", "id#fragment"])(
  "refuses unsafe message ID %s before requesting a detail path",
  async (ID) => {
    let requests = 0;
    globalThis.fetch = (() => {
      requests++;
      return Promise.resolve(response({ messages: [summary(ID)] }));
    }) as unknown as typeof fetch;
    await expect(waitForEmail(recipient, subject)).rejects.toThrow(
      "Invalid Mailpit message ID"
    );
    expect(requests).toBe(1);
  }
);

test("fails on truncated snapshots instead of allowing unseen stale mail", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      response({ messages: [], messages_count: 10 })
    )) as unknown as typeof fetch;
  await expect(captureMailpitMessageIds(recipient)).rejects.toThrow(
    "snapshot incomplete"
  );
  globalThis.fetch = (() =>
    Promise.resolve(
      response({ messages: [], messages_count: 5001 })
    )) as unknown as typeof fetch;
  await expect(captureMailpitMessageIds(recipient)).rejects.toThrow(
    "mailbox budget"
  );
});

test.each(["http", "malformed", "oversized"])(
  "rejects %s detail responses instead of returning a link",
  async (kind) => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname.endsWith("/messages")) {
        return Promise.resolve(response({ messages: [summary("fresh")] }));
      }
      if (kind === "http") {
        return Promise.resolve(new Response("failed", { status: 503 }));
      }
      if (kind === "malformed") {
        return Promise.resolve(response({ HTML: 7 }));
      }
      return Promise.resolve(response({ HTML: "x".repeat(2 * 1024 * 1024) }));
    }) as unknown as typeof fetch;
    const errors: Record<string, string> = {
      http: "503",
      malformed: "Malformed",
      oversized: "size limit",
    };
    await expect(waitForEmail(recipient, subject)).rejects.toThrow(
      errors[kind]
    );
  }
);

test("poll and hanging network requests both stop within the supplied timeout", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      response({ messages: [summary("stale")] })
    )) as unknown as typeof fetch;
  await expect(
    waitForEmail(recipient, subject, {
      excludeMessageIds: ["stale"],
      timeoutMs: 10,
      pollIntervalMs: 1,
    })
  ).rejects.toThrow("Timed out");
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("request aborted")),
        { once: true }
      );
    })) as unknown as typeof fetch;
  await expect(
    waitForEmail(recipient, subject, { timeoutMs: 10, pollIntervalMs: 1 })
  ).rejects.toThrow("aborted");
});

test("a stalled response body obeys the same overall polling deadline", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(new ReadableStream())
    )) as unknown as typeof fetch;
  await expect(
    waitForEmail(recipient, subject, { timeoutMs: 10, pollIntervalMs: 1 })
  ).rejects.toThrow("response deadline");
});
