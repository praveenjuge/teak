// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import {
  assertAllowedAuthCallbackUrl,
  requireOAuthConsentPrompt,
  teakOAuthSecurity,
} from "../oauthSecurity";

describe("requireOAuthConsentPrompt", () => {
  test("forces consent for first-party and external clients", () => {
    expect(requireOAuthConsentPrompt()).toBe("consent");
  });
});

describe("assertAllowedAuthCallbackUrl", () => {
  test("accepts the exact teak:// production callback", () => {
    expect(() =>
      assertAllowedAuthCallbackUrl("teak://", "https://app.teakvault.com")
    ).not.toThrow();
  });

  test("rejects attacker-controlled teak:// variants in production", () => {
    expect(() =>
      assertAllowedAuthCallbackUrl("teak://evil", "https://app.teakvault.com")
    ).toThrow();
    expect(() =>
      assertAllowedAuthCallbackUrl("teak://*", "https://app.teakvault.com")
    ).toThrow();
  });

  test("rejects Expo callbacks on production deployments", () => {
    expect(() =>
      assertAllowedAuthCallbackUrl(
        "exp://192.168.1.4:8081",
        "https://app.teakvault.com"
      )
    ).toThrow();
  });

  test("allows Expo callbacks on local deployments", () => {
    expect(() =>
      assertAllowedAuthCallbackUrl(
        "exp://192.168.1.4:8081",
        "http://app.teak.localhost:1355"
      )
    ).not.toThrow();
  });
});

describe("teakOAuthSecurity", () => {
  test("returns an exact consent prompt for first-party authorization", async () => {
    const hook = teakOAuthSecurity().hooks?.before?.find(({ matcher }) =>
      matcher({ path: "/mcp/authorize", context: {} } as never)
    );

    const result = await hook?.handler({
      query: { client_id: "teak-cli", prompt: "login" },
      context: {},
    });

    expect(result?.context?.query).toMatchObject({
      client_id: "teak-cli",
      prompt: "consent",
    });
  });

  test("returns an exact consent prompt for external authorization", async () => {
    const hook = teakOAuthSecurity().hooks?.before?.find(({ matcher }) =>
      matcher({ path: "/mcp/authorize", context: {} } as never)
    );

    const result = await hook?.handler({
      query: { client_id: "external-client", prompt: "login" },
      context: {},
    });

    expect(result?.context?.query).toMatchObject({
      client_id: "external-client",
      prompt: "consent",
    });
  });

  test("rejects malicious custom-scheme callbacks before Better Auth", async () => {
    const hook = teakOAuthSecurity().hooks?.before?.find(({ matcher }) =>
      matcher({
        path: "/sign-in/social",
        body: { callbackURL: "teak://evil" },
        context: {},
      } as never)
    );

    await expect(
      hook?.handler({
        body: { callbackURL: "teak://evil" },
        context: {},
      })
    ).rejects.toBeInstanceOf(Error);
  });

  test("atomically claims a refresh token before the upstream exchange", async () => {
    const adapter = {
      create: mock().mockResolvedValue({}),
      findOne: mock().mockResolvedValue({
        clientId: "teak-cli",
        refreshTokenExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
        userId: "user_1",
      }),
      update: mock().mockResolvedValue({}),
    };
    const hook = teakOAuthSecurity().hooks?.before?.find(({ matcher }) =>
      matcher({ path: "/mcp/token", context: {} } as never)
    );
    const context = {
      body: {
        grant_type: "refresh_token",
        refresh_token: "old-refresh",
      },
      context: { adapter },
    };

    const result = await hook?.handler(context);

    expect(adapter.update).toHaveBeenCalledWith({
      model: "oauthAccessToken",
      where: [{ field: "refreshToken", value: "old-refresh" }],
      update: {
        refreshToken: expect.stringContaining("claimed-"),
        updatedAt: expect.any(Date),
      },
    });
    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "verification",
        data: expect.objectContaining({
          identifier: expect.stringContaining("teak-oauth-used-refresh:"),
        }),
      })
    );
    expect(result?.context?.body.refresh_token).toStartWith("claimed-");
  });

  test("revokes the token family when a consumed refresh token is replayed", async () => {
    const adapter = {
      deleteMany: mock().mockResolvedValue(2),
      findOne: mock()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          value: JSON.stringify({
            clientId: "external-client",
            userId: "user_1",
          }),
        }),
    };
    const hook = teakOAuthSecurity().hooks?.before?.find(({ matcher }) =>
      matcher({ path: "/mcp/token", context: {} } as never)
    );

    await expect(
      hook?.handler({
        body: {
          grant_type: "refresh_token",
          refresh_token: "used-refresh",
        },
        context: { adapter },
      })
    ).rejects.toBeInstanceOf(Error);
    expect(adapter.deleteMany).toHaveBeenCalledWith({
      model: "oauthAccessToken",
      where: [
        { field: "clientId", value: "external-client" },
        { field: "userId", value: "user_1" },
      ],
    });
  });

  test("rotates refresh tokens with an absolute family expiry", async () => {
    const expiresAt = new Date("2026-09-01T00:00:00.000Z");
    const adapter = {
      delete: mock().mockResolvedValue(undefined),
      findOne: mock().mockResolvedValue({
        clientId: "teak-cli",
        refreshTokenExpiresAt: expiresAt,
        userId: "user_1",
      }),
      update: mock().mockResolvedValue({}),
    };
    const hook = teakOAuthSecurity().hooks?.after?.find(({ matcher }) =>
      matcher({ path: "/mcp/token", context: {} } as never)
    );

    await hook?.handler({
      body: {
        grant_type: "refresh_token",
        refresh_token: "old-refresh",
      },
      context: {
        adapter,
        returned: {
          access_token: "new-access",
          refresh_token: "new-refresh",
        },
      },
    });

    expect(adapter.update).toHaveBeenCalledWith({
      model: "oauthAccessToken",
      where: [{ field: "accessToken", value: "new-access" }],
      update: {
        refreshTokenExpiresAt: expiresAt,
        updatedAt: expect.any(Date),
      },
    });
    expect(adapter.delete).toHaveBeenCalledWith({
      model: "oauthAccessToken",
      where: [{ field: "refreshToken", value: "old-refresh" }],
    });
  });

  test("redacts refresh credentials from the MCP session response", async () => {
    const hook = teakOAuthSecurity().hooks?.after?.find(({ matcher }) =>
      matcher({ path: "/mcp/get-session", context: {} } as never)
    );
    const context = {
      context: {
        returned: {
          accessToken: "access",
          clientId: "teak-cli",
          refreshToken: "secret-refresh",
          userId: "user_1",
        },
      },
    };

    await hook?.handler(context);

    expect(context.context.returned).toEqual({
      clientId: "teak-cli",
      userId: "user_1",
    });
  });

  test("binds consent approval to the user who started authorization", async () => {
    const hook = teakOAuthSecurity().hooks?.before?.find(({ matcher }) =>
      matcher({ path: "/oauth2/consent", context: {} } as never)
    );
    const adapter = {
      findOne: mock().mockResolvedValue({
        // Convex persists Better Auth date fields as numeric timestamps.
        expiresAt: Date.now() + 60_000,
        value: JSON.stringify({ userId: "user_1" }),
      }),
    };
    const context = {
      body: { consent_code: "consent-code" },
      context: {
        adapter,
        session: { session: { userId: "user_1" }, user: { id: "user_1" } },
      },
    };

    await expect(hook?.handler(context)).resolves.toBeUndefined();

    context.context.session.user.id = "user_2";
    await expect(hook?.handler(context)).rejects.toThrow(
      "Invalid authorization request"
    );
  });
});
