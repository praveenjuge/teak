// @ts-nocheck

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { getFunctionName } from "convex/server";
import { listCardsV1 } from "../publicApiHttp";
import {
  validatePublicApiBearer,
  withAuthorizedUser,
} from "../publicApiHttpAuth";
import { runHandler } from "./helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "./helpers/session.test-utils";

const API_KEY =
  "teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const LEGACY_TOKEN = "A".repeat(32);
const VALID_KEY = {
  keyId: "key_1",
  userId: "user_1",
  access: "full_access",
  source: "component",
  rateLimitKey: "component:key_1",
};

const base64url = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replace(/[=]+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
const connectToken = (exp: number) =>
  `${base64url({ alg: "RS256", kid: "k1" })}.${base64url({ exp, sub: "user_x" })}.c2ln`;

const request = (token?: string, path = "/v1/cards") =>
  new Request(`https://api.teakvault.com${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

// Dispatch by function name, so the test states which boundary call answers what.
const backend = (answers: Record<string, unknown>) =>
  withMappedOwner({
    runMutation: mock((ref) => {
      const name = getFunctionName(ref);
      if (!(name in answers)) {
        return Promise.reject(new Error(`unexpected mutation ${name}`));
      }
      const answer = answers[name];
      // An Error answer is a rejection, created only when the call happens.
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    }),
    runQuery: mock(async () => null),
  });

const env = { ...process.env };
let log: ReturnType<typeof spyOn>;
const outcomes = () =>
  log.mock.calls
    .filter((call) => call[0] === "public_api_auth_outcome")
    .map((call) => call[1]);

beforeEach(() => {
  log = spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
  for (const key of ["WORKOS_AUTHKIT_DOMAIN"]) {
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
});

describe("public API auth outcomes", () => {
  test("missing bearer is logged as missing with the unchanged 401", async () => {
    const auth = await withAuthorizedUser(backend({}), request());
    expect(auth.error.status).toBe(401);
    expect((await auth.error.json()).code).toBe("UNAUTHORIZED");
    expect(outcomes()).toEqual([
      {
        surface: "rest",
        check: "request",
        status: 401,
        credential: "missing",
        reason: "missing_bearer",
      },
    ]);
  });

  test("malformed bearer still charges the shared invalid-auth bucket", async () => {
    const ctx = backend({
      "publicApi:consumeInvalidApiAuthLimit": { ok: true },
    });
    const auth = await withAuthorizedUser(ctx, request("garbage"));
    expect(auth.error.status).toBe(401);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(outcomes()[0]).toMatchObject({
      credential: "malformed",
      reason: "malformed_credential",
    });
  });

  test("an old-build Better Auth token is separated from other 401s", async () => {
    const auth = await withAuthorizedUser(
      backend({ "publicApi:consumeInvalidApiAuthLimit": { ok: true } }),
      request(LEGACY_TOKEN),
      { resource: "mcp" }
    );
    expect(auth.error.status).toBe(401);
    expect((await auth.error.json()).code).toBe("INVALID_API_KEY");
    expect(outcomes()).toEqual([
      {
        surface: "mcp",
        check: "request",
        status: 401,
        credential: "betterauth_oauth",
        reason: "nonprimary_credential",
      },
    ]);
  });

  test("a revoked API key is an invalid credential", async () => {
    const auth = await withAuthorizedUser(
      backend({
        "apiKeys:validateUserApiKey": null,
        "publicApi:consumeInvalidApiAuthLimit": { ok: true },
      }),
      request(API_KEY)
    );
    expect(auth.error.status).toBe(401);
    expect(outcomes()[0]).toMatchObject({
      credential: "api_key",
      reason: "invalid_credential",
    });
  });

  test("an exhausted invalid-auth bucket keeps its 429", async () => {
    const auth = await withAuthorizedUser(
      backend({
        "apiKeys:validateUserApiKey": null,
        "publicApi:consumeInvalidApiAuthLimit": {
          ok: false,
          retryAt: Date.now() + 5000,
        },
      }),
      request(API_KEY)
    );
    expect(auth.error.status).toBe(429);
    expect(outcomes()[0]).toMatchObject({
      status: 429,
      reason: "invalid_auth_rate_limited",
    });
  });

  test("a valid key over its own rate limit keeps its 429", async () => {
    const auth = await withAuthorizedUser(
      backend({
        "apiKeys:validateUserApiKey": VALID_KEY,
        "publicApi:checkApiRateLimit": {
          ok: false,
          retryAt: Date.now() + 5000,
        },
      }),
      request(API_KEY)
    );
    expect(auth.error.status).toBe(429);
    expect(outcomes()[0]).toMatchObject({
      status: 429,
      reason: "rate_limited",
    });
  });

  test("the MCP transport gate is logged once as a gate check", async () => {
    const error = await validatePublicApiBearer(
      backend({ "apiKeys:validateUserApiKey": VALID_KEY }),
      request(API_KEY, "/mcp"),
      "mcp"
    );
    expect(error).toBeNull();
    expect(outcomes()).toEqual([
      {
        surface: "mcp",
        check: "gate",
        status: 200,
        credential: "api_key",
        reason: "ok",
      },
    ]);
  });

  test.each([
    [
      "an unreachable JWKS",
      () => Promise.reject(new Error("offline")),
      Date.now() / 1000 + 60,
      "jwks_unavailable",
    ],
    [
      "an expired token",
      () => Promise.resolve(Response.json({ keys: [] })),
      Date.now() / 1000 - 60,
      "expired_token",
    ],
    [
      "an unverifiable token",
      () => Promise.resolve(Response.json({ keys: [] })),
      Date.now() / 1000 + 60,
      "invalid_token",
    ],
  ])(
    "a Connect token rejected for %s keeps the same 401",
    async (_name, fetchImpl, exp, reason) => {
      process.env.WORKOS_AUTHKIT_DOMAIN = `https://${reason.replace(/_/gu, "-")}.auth.example.com`;
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
      try {
        const auth = await withAuthorizedUser(
          backend({ "publicApi:consumeInvalidApiAuthLimit": { ok: true } }),
          request(connectToken(Math.floor(exp)))
        );
        expect(auth.error.status).toBe(401);
        expect((await auth.error.json()).error).toBe(
          "Invalid or expired access token"
        );
        expect(outcomes()[0]).toMatchObject({
          credential: "workos_connect",
          reason,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    }
  );

  test.each([
    [
      "a missing AuthKit issuer",
      () => {
        delete process.env.WORKOS_AUTHKIT_DOMAIN;
      },
      {},
      connectToken(Math.floor(Date.now() / 1000) + 60),
      500,
      "issuer_unconfigured",
    ],
    [
      "a validator that throws",
      () => undefined,
      {
        "apiKeys:validateUserApiKey": new Error("db down"),
      },
      API_KEY,
      500,
      "internal_error",
    ],
    [
      "per-key limiter contention",
      () => undefined,
      {
        "apiKeys:validateUserApiKey": VALID_KEY,
        "publicApi:checkApiRateLimit": new Error(
          'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry'
        ),
      },
      API_KEY,
      429,
      "rate_limit_contention",
    ],
  ])(
    "%s keeps its response and names the reason",
    async (_name, setup, answers, token, status, reason) => {
      setup();
      const auth = await withAuthorizedUser(backend(answers), request(token));
      expect(auth.error.status).toBe(status);
      expect(outcomes()[0]).toMatchObject({ status, reason });
    }
  );

  test("a valid key whose owner is being deleted is owner_unresolved", async () => {
    const ctx = {
      runMutation: mock((ref) =>
        Promise.resolve(
          getFunctionName(ref) === "apiKeys:validateUserApiKey"
            ? VALID_KEY
            : { ok: true }
        )
      ),
      runQuery: mock((ref) =>
        Promise.resolve(
          getFunctionName(ref) === "accountDeletion:isDeleting" ? true : null
        )
      ),
    };
    const auth = await withAuthorizedUser(ctx, request(API_KEY));
    expect(auth.error.status).toBe(401);
    expect(outcomes()[0]).toMatchObject({
      credential: "api_key",
      reason: "owner_unresolved",
    });
  });

  test("a legitimate REST request is unchanged and logs no credential", async () => {
    const query = mock().mockResolvedValue({
      itemCursors: [],
      items: [],
      nextCursor: null,
      scannedRows: 0,
    });
    const response = await runHandler(
      listCardsV1,
      {
        runMutation: mock()
          .mockResolvedValueOnce(VALID_KEY)
          .mockResolvedValueOnce({ ok: true }),
        runQuery: query,
      },
      request(API_KEY)
    );
    expect(response.status).toBe(200);
    expect(outcomes()).toEqual([
      {
        surface: "rest",
        check: "request",
        status: 200,
        credential: "api_key",
        reason: "ok",
      },
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("teakapi_");
  });

  test("a broken log sink never changes the response", async () => {
    log.mockImplementation(() => {
      throw new Error("log sink down");
    });
    const auth = await withAuthorizedUser(
      backend({
        "apiKeys:validateUserApiKey": VALID_KEY,
        "publicApi:checkApiRateLimit": { ok: true },
      }),
      request(API_KEY)
    );
    expect(auth.validated).toMatchObject({ keyId: "key_1", userId: "user_1" });
  });
});
