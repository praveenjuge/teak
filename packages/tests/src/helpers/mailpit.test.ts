import { afterEach, beforeEach, expect, test } from "bun:test";
import { env } from "./env";
import {
  captureMailpitMessageIds,
  exactLinkPredicate,
  waitForEmail,
  waitForEmailCode,
} from "./mailpit";

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

// Fresh mode: the sender, request time and code pattern stand in for root
// proof. Failure modes: an older or resent message, a lookalike sender, a
// shared recipient, two codes, and a link the proven shape does not admit.
const sentAfter = Date.parse("2026-10-08T10:00:00Z");
const sender = "no-reply@auth.example.com";
const fresh = { from: sender, sentAfter };
const freshSummary = (ID: string, changes: Record<string, unknown> = {}) => ({
  ...summary(ID),
  From: { Address: sender },
  Cc: [],
  Bcc: [],
  Created: "2026-10-08T10:00:05Z",
  ...changes,
});
const mailbox = (
  summaries: unknown[],
  detail: Record<string, string>,
  details: string[] = []
) => {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/messages")) {
      return Promise.resolve(response({ messages: summaries }));
    }
    details.push(path);
    return Promise.resolve(response(detail));
  }) as unknown as typeof fetch;
};
const code = /\b(\d{6})\b/;
const limits = { timeoutMs: 10, pollIntervalMs: 1 };

test("reads the code from the single fresh message and returns its exact ID", async () => {
  const details: string[] = [];
  mailbox(
    [
      freshSummary("older", { Created: "2026-10-08T09:58:00Z" }),
      freshSummary("lookalike", {
        From: { Address: "no-reply@auth.example.com.evil.test" },
      }),
      freshSummary("shared", {
        To: [{ Address: recipient }, { Address: "x@tests.example.com" }],
      }),
      freshSummary("copied", { Cc: [{ Address: "x@tests.example.com" }] }),
      freshSummary("baseline"),
      freshSummary("fresh"),
    ],
    { Text: "Your code is 123456. It expires soon." },
    details
  );
  expect(
    await waitForEmailCode(recipient, subject, code, {
      fresh,
      excludeMessageIds: ["baseline"],
      ...limits,
    })
  ).toEqual({ code: "123456", messageId: "fresh" });
  expect(details).toEqual(["/api/v1/message/fresh"]);
});

test.each([
  ["two distinct codes", { Text: "Use 123456 or 654321" }],
  ["no code", { Text: "Welcome" }],
])("refuses %s without echoing any code", async (_name, detail) => {
  mailbox([freshSummary("fresh")], detail);
  const failure = await waitForEmailCode(recipient, subject, code, {
    fresh,
    ...limits,
  }).catch((error: Error) => error.message);
  expect(failure).toContain("no single matching code");
  expect(failure).not.toMatch(/\d{6}/);
});

test("falls back to tag-stripped HTML and accepts one code repeated", async () => {
  mailbox([freshSummary("fresh")], {
    HTML: "<p>Code</p><strong>123456</strong><p>Again: 123456</p>",
  });
  expect(
    (await waitForEmailCode(recipient, subject, code, { fresh, ...limits }))
      .code
  ).toBe("123456");
});

test("two fresh matching messages fail closed instead of picking one", async () => {
  mailbox([freshSummary("one"), freshSummary("two")], { Text: "123456" });
  await expect(
    waitForEmailCode(recipient, subject, code, { fresh, ...limits })
  ).rejects.toThrow("Ambiguous fresh");
});

test("fresh mode ignores messages from before the request and times out", async () => {
  mailbox([freshSummary("older", { Created: "2026-10-08T09:58:59Z" })], {
    Text: "123456",
  });
  await expect(
    waitForEmailCode(recipient, subject, code, { fresh, ...limits })
  ).rejects.toThrow("Timed out");
});

const proven = exactLinkPredicate({
  origin: "https://auth.example.com",
  pathname: "/reset-password",
  param: "token",
});

test.each([
  [
    "a lookalike origin",
    "https://auth.example.com.evil.test/reset-password?token=a",
  ],
  ["plain http", "http://auth.example.com/reset-password?token=a"],
  ["userinfo", "https://user:pw@auth.example.com/reset-password?token=a"],
  ["a missing token", "https://auth.example.com/reset-password?state=a"],
  ["an empty token", "https://auth.example.com/reset-password?token="],
  [
    "a repeated token",
    "https://auth.example.com/reset-password?token=a&amp;token=b",
  ],
  ["another path", "https://auth.example.com/reset?token=a"],
])("the proven reset link shape rejects %s", async (_name, link) => {
  mailbox([freshSummary("fresh")], { HTML: `<a href="${link}">Reset</a>` });
  await expect(
    waitForEmail(recipient, subject, {
      fresh,
      linkPredicate: proven,
      ...limits,
    })
  ).rejects.toThrow("no matching link");
});

test("fresh mode returns the single proven link and refuses two distinct ones", async () => {
  const good = "https://auth.example.com/reset-password?token=one";
  mailbox([freshSummary("fresh")], {
    HTML: `<a href="${good}">Reset</a>`,
    Text: good,
  });
  expect(
    await waitForEmail(recipient, subject, {
      fresh,
      linkPredicate: proven,
      ...limits,
    })
  ).toBe(good);
  mailbox([freshSummary("fresh")], {
    HTML: `<a href="${good}">Reset</a><a href="${good.replace("one", "two")}">Again</a>`,
  });
  await expect(
    waitForEmail(recipient, subject, {
      fresh,
      linkPredicate: proven,
      ...limits,
    })
  ).rejects.toThrow("no matching link");
});

test.each(["http://auth.example.com", "https://auth.example.com/path"])(
  "refuses an unproven link origin %s",
  (origin) => {
    expect(() =>
      exactLinkPredicate({
        origin,
        pathname: "/reset-password",
        param: "token",
      })
    ).toThrow("Invalid proven link shape");
  }
);
