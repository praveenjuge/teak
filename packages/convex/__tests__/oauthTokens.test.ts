// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import {
  getOAuthConsentRequest,
  getOAuthUserInfo,
  isWellFormedOAuthToken,
  listOAuthConnections,
  revokeOAuthConnection,
  validateOAuthAccessToken,
} from "../oauthTokens";

const runHandler = (fn: any, ctx: any, args: any) =>
  (fn.handler ?? fn)(ctx, args);

describe("isWellFormedOAuthToken", () => {
  test("accepts 32-char alphanumeric tokens", () => {
    expect(isWellFormedOAuthToken("a".repeat(32))).toBe(true);
    expect(isWellFormedOAuthToken("AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf")).toBe(
      true
    );
    // Better Auth's random-string alphabet can include digits, so a 32-char
    // alphanumeric token must be accepted (not treated as malformed).
    expect(isWellFormedOAuthToken("a1".repeat(16))).toBe(true);
    expect(isWellFormedOAuthToken("0123456789abcdefABCDEF0123456789")).toBe(
      true
    );
  });

  test("rejects wrong length, non-alphanumerics, and API keys", () => {
    expect(isWellFormedOAuthToken("a".repeat(31))).toBe(false);
    expect(isWellFormedOAuthToken("a".repeat(33))).toBe(false);
    // Hyphen is outside the opaque alphanumeric shape.
    expect(isWellFormedOAuthToken(`a-${"b".repeat(30)}`)).toBe(false);
    expect(
      isWellFormedOAuthToken(`teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`)
    ).toBe(false);
  });
});

describe("validateOAuthAccessToken", () => {
  const token = "a".repeat(32);

  test("resolves a validated OAuth user for a live token", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        _id: "oauthAccessToken_1",
        accessTokenExpiresAt: Date.now() + 60_000,
        clientId: "teak-raycast",
        userId: "user_1",
      })
      .mockResolvedValueOnce({ _id: "user_1" });

    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );

    expect(result).toEqual({
      access: "full_access",
      keyId: "oauthAccessToken_1",
      rateLimitKey: "oauth:teak-raycast:user_1",
      source: "oauth",
      userId: "user_1",
    });
  });

  test("returns null when the token row is missing", async () => {
    const runQuery = mock().mockResolvedValueOnce(null);
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );
    expect(result).toBeNull();
  });

  test("returns null for an expired token", async () => {
    const runQuery = mock().mockResolvedValueOnce({
      _id: "t1",
      accessTokenExpiresAt: Date.now() - 1000,
      clientId: "teak-raycast",
      userId: "user_1",
    });
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );
    expect(result).toBeNull();
  });

  test("returns null when the user no longer exists", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        _id: "t1",
        accessTokenExpiresAt: Date.now() + 60_000,
        clientId: "teak-raycast",
        userId: "user_1",
      })
      .mockResolvedValueOnce(null);
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );
    expect(result).toBeNull();
  });

  test("rejects a malformed token without touching the database", async () => {
    const runQuery = mock();
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token: "short" }
    );
    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("rejects external-client tokens without recorded user consent", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        _id: "t1",
        accessTokenExpiresAt: Date.now() + 60_000,
        clientId: "external-client",
        scopes: "openid offline_access",
        userId: "user_1",
      })
      .mockResolvedValueOnce({ _id: "user_1" })
      .mockResolvedValueOnce(null);

    expect(
      await runHandler(validateOAuthAccessToken, { runQuery }, { token })
    ).toBeNull();
  });

  test("accepts external-client tokens only within consented scopes", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        _id: "t1",
        accessTokenExpiresAt: Date.now() + 60_000,
        clientId: "external-client",
        scopes: "openid offline_access",
        userId: "user_1",
      })
      .mockResolvedValueOnce({ _id: "user_1" })
      .mockResolvedValueOnce({ scopes: "openid offline_access profile" });

    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );
    expect(result?.userId).toBe("user_1");
  });
});

describe("getOAuthUserInfo", () => {
  const token = "b".repeat(32);

  test("returns standard userinfo claims for a live token", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        _id: "oauthAccessToken_1",
        accessTokenExpiresAt: Date.now() + 60_000,
        clientId: "teak-raycast",
        userId: "user_1",
      })
      .mockResolvedValueOnce({
        _id: "user_1",
        email: "hello@example.com",
        emailVerified: true,
        name: "Ada Lovelace",
      });

    const result = await runHandler(getOAuthUserInfo, { runQuery }, { token });

    expect(result).toEqual({
      sub: "user_1",
      email: "hello@example.com",
      email_verified: true,
      name: "Ada Lovelace",
    });
  });

  test("returns null for expired or malformed tokens", async () => {
    const expiredQuery = mock().mockResolvedValueOnce({
      _id: "oauthAccessToken_1",
      accessTokenExpiresAt: Date.now() - 1,
      clientId: "teak-raycast",
      userId: "user_1",
    });

    expect(
      await runHandler(getOAuthUserInfo, { runQuery: expiredQuery }, { token })
    ).toBeNull();

    const malformedQuery = mock();
    expect(
      await runHandler(
        getOAuthUserInfo,
        { runQuery: malformedQuery },
        { token: "short" }
      )
    ).toBeNull();
    expect(malformedQuery).not.toHaveBeenCalled();
  });
});

describe("OAuth connection management", () => {
  test("loads consent display data from the authenticated server request", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        expiresAt: Date.now() + 60_000,
        value: JSON.stringify({
          clientId: "external-client",
          requireConsent: true,
          scope: ["openid", "offline_access"],
          userId: "user_1",
        }),
      })
      .mockResolvedValueOnce({ name: "Trusted Notes" });
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      runQuery,
    };

    expect(
      await runHandler(getOAuthConsentRequest, ctx, {
        consentCode: "consent-code",
      })
    ).toEqual({
      clientId: "external-client",
      name: "Trusted Notes",
      scopes: ["openid", "offline_access"],
    });
  });

  test("does not expose a consent request to a different user", async () => {
    const runQuery = mock().mockResolvedValueOnce({
      expiresAt: Date.now() + 60_000,
      value: JSON.stringify({
        clientId: "external-client",
        requireConsent: true,
        scope: ["openid"],
        userId: "user_2",
      }),
    });
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      runQuery,
    };

    expect(
      await runHandler(getOAuthConsentRequest, ctx, {
        consentCode: "consent-code",
      })
    ).toBeNull();
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  test("lists distinct clients for only the authenticated user", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        page: [
          {
            clientId: "teak-cli",
            createdAt: 20,
            refreshTokenExpiresAt: 200,
          },
          {
            clientId: "teak-cli",
            createdAt: 10,
            refreshTokenExpiresAt: 300,
          },
        ],
      })
      .mockResolvedValueOnce({ name: "Teak CLI" });
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      runQuery,
    };

    expect(await runHandler(listOAuthConnections, ctx, {})).toEqual([
      {
        clientId: "teak-cli",
        connectedAt: 10,
        expiresAt: 300,
        name: "Teak CLI",
      },
    ]);
    expect(runQuery.mock.calls[0][1].where).toEqual([
      { field: "userId", operator: "eq", value: "user_1" },
    ]);
  });

  test("revokes only the selected client for the authenticated user", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({ page: [{ _id: "token_1" }] })
      .mockResolvedValueOnce({ page: [{ _id: "consent_1" }] });
    const runMutation = mock().mockResolvedValue(undefined);
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      runMutation,
      runQuery,
    };

    expect(
      await runHandler(revokeOAuthConnection, ctx, {
        clientId: "external-client",
      })
    ).toBeNull();
    expect(runQuery.mock.calls[0][1].where).toEqual([
      { field: "clientId", operator: "eq", value: "external-client" },
      { field: "userId", operator: "eq", value: "user_1" },
    ]);
    expect(runMutation).toHaveBeenCalledTimes(2);
  });
});
