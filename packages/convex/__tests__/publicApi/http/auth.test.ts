import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  buildEdgeRateLimitSigningPayload,
  EDGE_RATE_LIMIT_HEADER,
} from "@teak/files-protocol";
import { type FunctionReference, getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { withAuthorizedUser } from "../../../publicApi/http/auth";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  listCardsV1,
} from "../../../publicApi/http/routes";
import { hmacSha256Hex, sha256Hex } from "../../../storage/r2Keys";
import { asFetch, mockActionCtx } from "../../helpers/convex.test-utils";
import {
  buildAuthorizedMutationMock,
  buildAuthorizedMutationMockWithIdempotencySkip,
  runHandler,
} from "../../helpers/publicApiHttp.test-utils";

describe("publicApiHttp auth and validation", () => {
  test("cardByIdV1 validates the API key for the favorite route", async () => {
    const runMutation = mock().mockResolvedValueOnce({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_1",
      rateLimit: {
        ok: false,
        retryAt: Date.now() + 30_000,
      },
    });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards/card_123/favorite", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isFavorited: true }),
      })
    );

    expect(response.status).toBe(429);
    expect(runMutation.mock.calls[0][1]).toEqual({
      token:
        "teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      chargeRateLimit: true,
    });
  });

  test("static card routes authorize with the bearer API key", async () => {
    const cases = [
      {
        handler: listCardsV1,
        method: "GET",
        path: "/v1/cards",
        query: mock().mockResolvedValue({
          itemCursors: [],
          items: [],
          nextCursor: null,
          scannedRows: 0,
        }),
      },
      {
        body: {
          items: [{ cardId: "card_1", isFavorited: true }],
          operation: "favorite",
        },
        handler: bulkCardsV1,
        method: "POST",
        mutation:
          buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce(
            {
              operation: "favorite",
              results: [{ cardId: "card_1", index: 0, status: "success" }],
              summary: { failed: 0, succeeded: 1, total: 1 },
            }
          ),
        path: "/v1/cards/bulk",
        query: mock(),
      },
      {
        handler: changesCardsV1,
        method: "GET",
        path: "/v1/cards/changes",
        queryString: "?since=1&limit=10",
        query: mock().mockResolvedValue({
          deletedIds: [],
          items: [],
          pageInfo: { hasMore: false, nextCursor: null },
        }),
      },
    ];

    for (const testCase of cases) {
      const runMutation = testCase.mutation ?? buildAuthorizedMutationMock();
      const response = await runHandler(
        testCase.handler,
        { runMutation, runQuery: testCase.query },
        new Request(
          `https://example.com${testCase.path}${
            testCase.queryString ?? "?limit=10"
          }`,
          {
            body: testCase.body ? JSON.stringify(testCase.body) : undefined,
            headers: {
              Authorization:
                "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              ...(testCase.body ? { "Content-Type": "application/json" } : {}),
            },
            method: testCase.method,
          }
        )
      );

      expect(response.status).toBe(200);
      expect(runMutation.mock.calls[0][1]).toEqual({
        token:
          "teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        chargeRateLimit: true,
      });
    }
  });

  test("createCardV1 returns 429 when the shared invalid-auth bucket is exhausted", async () => {
    const runMutation = mock().mockResolvedValueOnce({
      ok: false,
      retryAt: Date.now() + 30_000,
    });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_zzz",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.code).toBe("RATE_LIMITED");
  });

  test("createCardV1 returns 401 for invalid API key", async () => {
    const runMutation = mock()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: true });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_API_KEY");
  });

  test("createCardV1 returns 400 for malformed JSON", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: "{invalid",
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("BAD_REQUEST");
  });

  test("createCardV1 returns 400 for empty content", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "    " }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("createCardV1 returns 400 for unsafe url scheme", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "javascript:alert(1)" }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("createCardV1 maps ConvexError payload to stable code", async () => {
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockRejectedValueOnce(
        new ConvexError({
          code: "INVALID_INPUT",
          message: "Content cannot be empty",
        })
      );

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toEqual({
      code: "INVALID_INPUT",
      error: "Content cannot be empty",
    });
  });

  test("createCardV1 returns created payload", async () => {
    const previousSiteUrl = process.env.SITE_URL;
    process.env.SITE_URL = "https://app.teakvault.com";
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce({
        status: "created",
        cardId: "card_9",
      });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "new card" }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appUrl: "https://app.teakvault.com/?card=card_9",
      cardId: "card_9",
      status: "created",
    });
    process.env.SITE_URL = previousSiteUrl;
  });

  test("createCardV1 rejects requests whose idempotency key is already in progress", async () => {
    const runMutation = mock()
      .mockResolvedValueOnce({
        access: "full_access",
        keyId: "key_1",
        userId: "user_1",
        source: "component",
        rateLimitKey: "component:key_1",
        rateLimit: { ok: true, retryAt: undefined },
      })
      .mockResolvedValueOnce({
        record: {
          _id: "idem_1",
          _creationTime: 1,
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          keyHash: "hash_1",
          method: "POST",
          path: "/v1/cards",
          requestHash: "request_hash",
          responseBody: null,
          responseStatus: 0,
          state: "pending",
          updatedAt: 1,
          userId: "user_1",
        },
        status: "in_progress",
      });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
          "Idempotency-Key": "save-card-1",
        },
        body: JSON.stringify({ content: "new card" }),
      })
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      code: "IN_PROGRESS",
      error: "Idempotency-Key is already being processed; retry shortly",
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });
});

describe("Connect consent checks", () => {
  const issuer = "https://consent-read.auth.example.com";
  const secret = "consent-read-test-secret";
  const principal = {
    workosUserId: "user_CONSENT",
    consentId: "app_consent_CONSENT",
    clientId: "client_CONSENT",
  };
  const saved = {
    issuer: process.env.WORKOS_AUTHKIT_DOMAIN,
    secret: process.env.FILES_SIGNING_SECRET,
  };
  let fetchSpy: ReturnType<typeof spyOn>;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;

  beforeAll(async () => {
    keys = await generateKeyPair("RS256", { extractable: true });
  });
  beforeEach(async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = issuer;
    process.env.FILES_SIGNING_SECRET = secret;
    const jwk = await exportJWK(keys.publicKey);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      asFetch(() =>
        Promise.resolve(
          Response.json({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] })
        )
      )
    );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    for (const [key, value] of [
      ["WORKOS_AUTHKIT_DOMAIN", saved.issuer],
      ["FILES_SIGNING_SECRET", saved.secret],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const request = async ({ attested }: { attested: boolean }) => {
    const now = Math.floor(Date.now() / 1000);
    const access = await new SignJWT({
      iss: issuer,
      aud: "https://teakvault.com/api",
      sub: principal.workosUserId,
      sid: principal.consentId,
      client_id: principal.clientId,
      scope: "openid profile email offline_access",
      iat: now,
      exp: now + 300,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .sign(keys.privateKey);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${access}`,
    };
    if (attested) {
      const expiresAt = String(now + 30);
      const signature = await hmacSha256Hex(
        secret,
        buildEdgeRateLimitSigningPayload({
          credentialSha256: await sha256Hex(headers.Authorization),
          expiresAt,
        })
      );
      headers[EDGE_RATE_LIMIT_HEADER] = `${expiresAt}.${signature}`;
    }
    return new Request("https://api.teakvault.com/v1/cards", { headers });
  };
  const backend = (read: unknown, write: unknown = null) => {
    const ctx = {
      runQuery: mock(() => Promise.resolve(read)),
      runMutation: mock(() => Promise.resolve(write)),
    };
    const calls = (fn: typeof ctx.runQuery) =>
      fn.mock.calls.map((call: unknown[]) => [
        getFunctionName(call[0] as FunctionReference<"query" | "mutation">),
        call[1],
      ]);
    return {
      ctx: mockActionCtx(ctx),
      queries: () => calls(ctx.runQuery),
      mutations: () => calls(ctx.runMutation),
    };
  };
  const read = ["workosConsents:readConnectConsent", principal];

  test("a charged request for a recently seen consent only reads", async () => {
    const b = backend({
      status: "ok",
      teakUserId: "owner_1",
      lastSeenAt: Date.now() - 60_000,
    });
    const auth = await withAuthorizedUser(
      b.ctx,
      await request({ attested: true })
    );
    expect(auth).toMatchObject({
      validated: { userId: "owner_1", keyId: principal.consentId },
    });
    expect(b.queries()).toEqual([read]);
    expect(b.mutations()).toEqual([]);
  });

  test("a charged request for a revoked consent is refused from the read alone", async () => {
    const b = backend({ status: "denied", reason: "revoked_consent" });
    const auth = await withAuthorizedUser(
      b.ctx,
      await request({ attested: true })
    );
    expect("error" in auth && auth.error.status).toBe(401);
    expect(b.queries()).toEqual([read]);
    expect(b.mutations()).toEqual([]);
  });

  test.each([
    ["never", null],
    ["five minutes ago", Date.now() - 300_000],
  ])(
    "a charged request for a consent last seen %s writes through the mutation",
    async (_label, lastSeenAt) => {
      const b = backend(
        { status: "ok", teakUserId: "owner_1", lastSeenAt },
        { status: "ok", teakUserId: "owner_1" }
      );
      const auth = await withAuthorizedUser(
        b.ctx,
        await request({ attested: true })
      );
      expect(auth).toMatchObject({ validated: { userId: "owner_1" } });
      expect(b.mutations()).toEqual([
        [
          "workosConsents:authorizeConnectConsent",
          { ...principal, chargeRateLimit: false },
        ],
      ]);
    }
  );

  test("an uncharged request skips the read and charges the rate limit", async () => {
    const b = backend(null, {
      status: "ok",
      teakUserId: "owner_1",
      rateLimit: { ok: false, retryAt: Date.now() + 5000 },
    });
    const auth = await withAuthorizedUser(
      b.ctx,
      await request({ attested: false })
    );
    expect("error" in auth && auth.error.status).toBe(429);
    expect(b.queries()).toEqual([]);
    expect(b.mutations()).toEqual([
      [
        "workosConsents:authorizeConnectConsent",
        { ...principal, chargeRateLimit: true },
      ],
    ]);
  });
});
