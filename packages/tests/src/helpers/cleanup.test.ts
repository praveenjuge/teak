import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  adoptE2ESignup,
  assertE2EProvisioningReady,
  cleanupE2EAccounts,
  isConfiguredE2EEmail,
  isE2ECleanupResult,
  provisionE2EAccount,
  reserveE2ESignup,
  summarizeE2ECleanup,
} from "./e2e-cleanup";
import { env } from "./env";
import {
  deleteMailpitMessages,
  type MailpitMessage,
  messageIdsForRecipients,
} from "./mailpit";

const noOpSleep = (): Promise<void> => Promise.resolve();

const originalFetch = globalThis.fetch;
const originalCleanupToken = env.cleanupToken;
const originalConvexSiteUrl = env.convexSiteUrl;
const originalEmailDomain = env.emailDomain;
const originalPassword = env.password;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.cleanupToken = originalCleanupToken;
  env.convexSiteUrl = originalConvexSiteUrl;
  env.emailDomain = originalEmailDomain;
  env.password = originalPassword;
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

  test("provisions only configured E2E accounts through the protected endpoint", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        Response.json({
          email: JSON.parse(String(init?.body)).email,
        })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await provisionE2EAccount(
      "e2e-primary@tests.example.com",
      "safe-password",
      noOpSleep
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toEndWith("/api/auth/internal/e2e/provision");
    expect(init?.headers).toEqual({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    await expect(
      provisionE2EAccount("person@example.com", "safe-password")
    ).rejects.toThrow("provisioning email is invalid");
  });

  test("provisioning retries a transient 5xx before succeeding", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    let attempts = 0;
    const fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      if (attempts === 1) {
        return Response.json(
          { message: "temporarily unavailable" },
          { status: 500 }
        );
      }
      return Response.json({
        email: JSON.parse(String(init?.body)).email,
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await provisionE2EAccount(
      "e2e-primary@tests.example.com",
      "safe-password",
      noOpSleep
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("provisioning does not mask a stale account behind a retried 5xx", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    let attempts = 0;
    const fetchMock = mock(() => {
      attempts += 1;
      if (attempts === 1) {
        return Response.json(
          { message: "temporarily unavailable" },
          { status: 500 }
        );
      }
      return Response.json(
        { code: "CONFLICT", message: "E2E account already exists" },
        { status: 409 }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      provisionE2EAccount(
        "e2e-primary@tests.example.com",
        "safe-password",
        noOpSleep
      )
    ).rejects.toThrow("Production E2E provisioning failed (409)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("provisioning does not mask a stale account behind a retried 429", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    let attempts = 0;
    const fetchMock = mock(() => {
      attempts += 1;
      if (attempts === 1) {
        return Response.json({ message: "slow down" }, { status: 429 });
      }
      return Response.json(
        { code: "CONFLICT", message: "E2E account already exists" },
        { status: 409 }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      provisionE2EAccount(
        "e2e-primary@tests.example.com",
        "safe-password",
        noOpSleep
      )
    ).rejects.toThrow("Production E2E provisioning failed (409)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("provisioning treats a conflict after a lost response as success", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    let attempts = 0;
    const fetchMock = mock(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("fetch failed");
      }
      return Response.json(
        { code: "CONFLICT", message: "E2E account already exists" },
        { status: 409 }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await provisionE2EAccount(
      "e2e-primary@tests.example.com",
      "safe-password",
      noOpSleep
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("provisioning rejects an explicit WorkOS account conflict after a lost response", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    let attempts = 0;
    globalThis.fetch = mock(() => {
      if (++attempts === 1) {
        throw new TypeError("fetch failed");
      }
      return Response.json({ code: "E2E_ACCOUNT_CONFLICT" }, { status: 409 });
    }) as unknown as typeof fetch;
    await expect(
      provisionE2EAccount(
        "e2e-primary@tests.example.com",
        "safe-password",
        noOpSleep
      )
    ).rejects.toThrow("Production E2E provisioning failed (409)");
  });

  test("provisioning reports network failure after exhausting retries", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    const fetchMock = mock(() => {
      throw new TypeError("fetch failed");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      provisionE2EAccount(
        "e2e-primary@tests.example.com",
        "safe-password",
        noOpSleep
      )
    ).rejects.toThrow("Production E2E provisioning failed (network)");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("retries preflight cleanup after a failed first attempt", async () => {
    env.cleanupToken = "test-token";
    env.convexSiteUrl = "https://example.convex.site";
    env.emailDomain = "tests.example.com";
    env.password = "safe-password";
    let cleanupAttempts = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url.endsWith("/api/auth/internal/e2e/provision")) {
        return Response.json({ email: body.email });
      }
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) {
        return Response.json(
          { message: "temporarily unavailable" },
          {
            status: 503,
          }
        );
      }
      return Response.json({
        alreadyDeleted: [],
        deleted: body.emails,
        failures: [],
        ignoredOutOfRange: [],
        remainingEligible: false,
      });
    }) as unknown as typeof fetch;

    await expect(assertE2EProvisioningReady()).rejects.toThrow(
      "invalid response (503)"
    );
    expect(cleanupAttempts).toBe(2);
  });
});

test("cleanup waits for durable completion and never treats accepted deletion as finished", async () => {
  env.cleanupToken = crypto.randomUUID();
  env.convexSiteUrl = "https://example.convex.site";
  const email = "e2e-durable@tests.example.com";
  let calls = 0;
  let waits = 0;
  globalThis.fetch = mock(() => {
    calls++;
    return Response.json(
      {
        alreadyDeleted: calls === 1 ? [] : [email],
        deleted: [],
        failures:
          calls === 1 ? [{ email, reason: "account cleanup pending" }] : [],
        ignoredOutOfRange: [],
        remainingEligible: false,
      },
      { status: calls === 1 ? 202 : 200 }
    );
  }) as unknown as typeof fetch;
  const result = await cleanupE2EAccounts([email], () => {
    waits++;
    return Promise.resolve();
  });
  expect(result.alreadyDeleted).toEqual([email]);
  expect(calls).toBe(2);
  expect(waits).toBe(1);
});

test("orphan cleanup traverses bounded provider and owner pages", async () => {
  env.cleanupToken = crypto.randomUUID();
  env.convexSiteUrl = "https://example.convex.site";
  const bodies: unknown[] = [];
  globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      alreadyDeleted: [],
      deleted: [`e2e-${bodies.length}@tests.example.com`],
      failures: [],
      ignoredOutOfRange: [],
      remainingEligible: bodies.length === 1,
      nextCursor: bodies.length === 1 ? "bounded-next-page" : null,
    });
  }) as unknown as typeof fetch;
  const result = await cleanupE2EAccounts(undefined, noOpSleep);
  expect(bodies).toEqual([{}, { cursor: "bounded-next-page" }]);
  expect(result.deleted).toEqual([
    "e2e-1@tests.example.com",
    "e2e-2@tests.example.com",
  ]);
});

test("orphan cleanup fails closed when a sweep cursor repeats", async () => {
  env.cleanupToken = crypto.randomUUID();
  env.convexSiteUrl = "https://example.convex.site";
  globalThis.fetch = mock(async () =>
    Response.json({
      alreadyDeleted: [],
      deleted: [],
      failures: [],
      ignoredOutOfRange: [],
      remainingEligible: true,
      nextCursor: "same-page",
    })
  ) as unknown as typeof fetch;
  await expect(cleanupE2EAccounts(undefined, noOpSleep)).rejects.toThrow(
    "non-progressing"
  );
});

test("provisioning retries an admitted pending account only after canonical readiness", async () => {
  env.cleanupToken = crypto.randomUUID();
  env.convexSiteUrl = "https://example.convex.site";
  env.emailDomain = "tests.example.com";
  let calls = 0;
  globalThis.fetch = mock(async () =>
    ++calls === 1
      ? Response.json({ code: "E2E_PROVISION_PENDING" }, { status: 503 })
      : Response.json(
          { email: "e2e-pending@tests.example.com" },
          { status: 409 }
        )
  ) as unknown as typeof fetch;
  await provisionE2EAccount(
    "e2e-pending@tests.example.com",
    crypto.randomUUID(),
    noOpSleep
  );
  expect(calls).toBe(2);
});

test("cleanup retries a lost timeout response for the exact admitted accounts", async () => {
  env.cleanupToken = "test-token";
  env.convexSiteUrl = "https://example.convex.site";
  const email = "e2e-timeout@tests.example.com";
  const bodies: string[] = [];
  globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) {
      return Promise.reject(new DOMException("Lost response", "TimeoutError"));
    }
    return Promise.resolve(
      Response.json({
        alreadyDeleted: [email],
        deleted: [],
        failures: [],
        ignoredOutOfRange: [],
        remainingEligible: false,
      })
    );
  }) as unknown as typeof fetch;
  const result = await cleanupE2EAccounts([email], noOpSleep);
  expect(result.alreadyDeleted).toEqual([email]);
  expect(bodies).toEqual([
    JSON.stringify({ emails: [email] }),
    JSON.stringify({ emails: [email] }),
  ]);
});

test("cleanup timeout retries stop at the existing overall deadline", async () => {
  env.cleanupToken = "test-token";
  env.convexSiteUrl = "https://example.convex.site";
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = mock(() => {
    calls++;
    return Promise.reject(new DOMException("Lost response", "TimeoutError"));
  }) as unknown as typeof fetch;
  try {
    await expect(
      cleanupE2EAccounts(["e2e-timeout@tests.example.com"], () => {
        now += 120_001;
        return Promise.resolve();
      })
    ).rejects.toThrow("cleanup remains unproven");
    expect(calls).toBe(1);
  } finally {
    Date.now = originalNow;
  }
});

test("cleanup does not retry unexpected request errors", async () => {
  env.cleanupToken = "test-token";
  env.convexSiteUrl = "https://example.convex.site";
  let calls = 0;
  globalThis.fetch = mock(() => {
    calls++;
    return Promise.reject(new Error("Unexpected failure"));
  }) as unknown as typeof fetch;
  await expect(
    cleanupE2EAccounts(["e2e-timeout@tests.example.com"], noOpSleep)
  ).rejects.toThrow("Unexpected failure");
  expect(calls).toBe(1);
});

const signupEnv = () => {
  env.cleanupToken = crypto.randomUUID();
  env.convexSiteUrl = "https://example.convex.site";
  env.emailDomain = "tests.example.com";
};
const reservation = {
  reservationId: "k57reservation",
  email: `e2e-signup-${"a".repeat(32)}@tests.example.com`,
  expiresAt: Date.now() + 30 * 60 * 1000,
};

test("signup reservation retries a lost response with the same request ID", async () => {
  signupEnv();
  const bodies: string[] = [];
  globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) {
      return Promise.reject(new TypeError("fetch failed"));
    }
    return Promise.resolve(Response.json(reservation));
  }) as unknown as typeof fetch;
  expect(await reserveE2ESignup(noOpSleep)).toEqual(reservation);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[0]).requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

test.each([
  ["a client-style recipient", { email: "e2e-primary@tests.example.com" }],
  ["another domain", { email: `e2e-signup-${"a".repeat(32)}@example.com` }],
  ["an expired lease", { expiresAt: Date.now() - 1 }],
])("signup reservation rejects %s from the server", async (_name, change) => {
  signupEnv();
  globalThis.fetch = mock(async () =>
    Response.json({ ...reservation, ...change })
  ) as unknown as typeof fetch;
  await expect(reserveE2ESignup(noOpSleep)).rejects.toThrow(
    "reservation response is invalid"
  );
});

test("signup reservation does not retry an exhausted budget", async () => {
  signupEnv();
  let calls = 0;
  globalThis.fetch = mock(() => {
    calls++;
    return Promise.resolve(
      Response.json({ code: "E2E_RESERVATION_BUDGET" }, { status: 429 })
    );
  }) as unknown as typeof fetch;
  await expect(reserveE2ESignup(noOpSleep)).rejects.toThrow(
    "failed (429) E2E_RESERVATION_BUDGET"
  );
  expect(calls).toBe(1);
});

test("signup adoption waits out a pending owner within the retry budget", async () => {
  signupEnv();
  const bodies: unknown[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toEndWith("/api/auth/internal/e2e/signup/adopt");
    bodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(
      bodies.length < 3
        ? Response.json({ code: "E2E_ADOPT_PENDING" }, { status: 503 })
        : Response.json({ email: reservation.email })
    );
  }) as unknown as typeof fetch;
  await adoptE2ESignup(reservation, noOpSleep);
  expect(bodies).toEqual(
    new Array(3).fill({
      reservationId: reservation.reservationId,
      email: reservation.email,
    })
  );
});

test("signup adoption treats a refused reservation as final", async () => {
  signupEnv();
  let calls = 0;
  globalThis.fetch = mock(() => {
    calls++;
    return Promise.resolve(
      Response.json({ code: "E2E_RESERVATION_UNAVAILABLE" }, { status: 409 })
    );
  }) as unknown as typeof fetch;
  await expect(adoptE2ESignup(reservation, noOpSleep)).rejects.toThrow(
    "failed (409) E2E_RESERVATION_UNAVAILABLE"
  );
  expect(calls).toBe(1);
});
