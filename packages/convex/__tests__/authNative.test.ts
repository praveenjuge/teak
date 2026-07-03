// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import {
  consumeNativeAuthByState,
  createNativeAuthCode,
  pollNativeAuthCode,
} from "../authNative";

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const createCodeChallenge = async (codeVerifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  return toBase64Url(new Uint8Array(digest));
};

const getHandler = (fn: unknown) => (fn as any).handler ?? fn;

describe("authNative.ts", () => {
  test("creates native auth codes for authenticated users", async () => {
    const insert = mock().mockResolvedValue("native-auth-id");
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({
          subject: "user_123",
          sessionId: "session_123",
        }),
      },
      db: { insert },
    };

    const result = await getHandler(createNativeAuthCode)(ctx, {
      deviceId: "desktop-device-123456",
      codeChallenge: "a".repeat(43),
      state: "state_123456789012",
      surface: "desktop",
    });

    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(insert).toHaveBeenCalledWith("nativeAuthCodes", {
      sessionId: "session_123",
      userId: "user_123",
      deviceId: "desktop-device-123456",
      codeChallenge: "a".repeat(43),
      state: "state_123456789012",
      surface: "desktop",
      expiresAt: expect.any(Number),
      consumedAt: undefined,
      createdAt: expect.any(Number),
    });
  });

  test("accepts the browser-extension surface", async () => {
    const insert = mock().mockResolvedValue("native-auth-id");
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({
          subject: "user_123",
          sessionId: "session_123",
        }),
      },
      db: { insert },
    };

    const result = await getHandler(createNativeAuthCode)(ctx, {
      deviceId: "extension-device-123456",
      codeChallenge: "a".repeat(43),
      state: "state_123456789012",
      surface: "browser-extension",
    });

    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(insert).toHaveBeenCalledWith(
      "nativeAuthCodes",
      expect.objectContaining({ surface: "browser-extension" })
    );
  });

  test("rejects invalid native surfaces", async () => {
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({
          subject: "user_123",
          sessionId: "session_123",
        }),
      },
      db: { insert: mock() },
    };

    await expect(
      getHandler(createNativeAuthCode)(ctx, {
        deviceId: "desktop-device-123456",
        codeChallenge: "a".repeat(43),
        state: "state_123456789012",
        surface: "watchos",
      })
    ).rejects.toThrow();
  });

  test("rejects invalid device, state, and code challenge inputs", async () => {
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({
          subject: "user_123",
          sessionId: "session_123",
        }),
      },
      db: { insert: mock() },
    };

    for (const args of [
      {
        deviceId: "short",
        codeChallenge: "a".repeat(43),
        state: "state_123456789012",
        surface: "desktop",
      },
      {
        deviceId: "desktop-device-123456",
        codeChallenge: "short",
        state: "state_123456789012",
        surface: "desktop",
      },
      {
        deviceId: "desktop-device-123456",
        codeChallenge: "a".repeat(43),
        state: "short",
        surface: "desktop",
      },
    ]) {
      await expect(
        getHandler(createNativeAuthCode)(ctx, args)
      ).rejects.toThrow();
    }
  });

  test("polls successfully and mints a fresh dedicated session", async () => {
    const codeVerifier = "a".repeat(48);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const authCode = {
      _id: "native-auth-id",
      sessionId: "session_123",
      userId: "user_123",
      deviceId: "extension-device-123456",
      codeChallenge,
      state: "state_123456789012",
      surface: "browser-extension",
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    };
    const collect = mock().mockResolvedValue([authCode]);
    const patch = mock().mockResolvedValue(null);
    const queryBuilder = {
      eq: mock(() => queryBuilder),
    };
    // adapter.create (dedicated session mint) runs through ctx.runMutation.
    const runMutation = mock().mockResolvedValue({ _id: "session-doc-id" });
    const ctx = {
      db: {
        patch,
        query: mock().mockReturnValue({
          withIndex: mock((_index, buildQuery) => {
            buildQuery(queryBuilder);
            return { collect };
          }),
        }),
      },
      // assertPairedSessionValid reads the paired web session; must be valid.
      runQuery: mock().mockResolvedValue({
        token: "paired-web-session-token",
        expiresAt: Date.now() + 60_000,
        userId: "user_123",
      }),
      runMutation,
    };

    const result = await getHandler(consumeNativeAuthByState)(ctx, {
      codeVerifier,
      deviceId: "extension-device-123456",
      state: "state_123456789012",
    });

    // Code is consumed exactly once.
    expect(patch).toHaveBeenCalledWith("native-auth-id", {
      consumedAt: expect.any(Number),
    });

    // A fresh dedicated session was minted via adapter.create with the
    // per-surface user agent — NOT the paired web session token.
    expect(runMutation).toHaveBeenCalledTimes(1);
    const createArgs = runMutation.mock.calls[0][1];
    expect(createArgs.input.model).toBe("session");
    expect(createArgs.input.data.userId).toBe("user_123");
    expect(createArgs.input.data.userAgent).toBe("Teak Browser Extension");
    const mintedToken = createArgs.input.data.token;
    expect(mintedToken).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(mintedToken).not.toBe("paired-web-session-token");

    expect(result).toEqual({
      sessionToken: mintedToken,
      expiresAt: expect.any(Number),
    });
  });

  test("rejects the poll when the paired web session is gone", async () => {
    const codeVerifier = "a".repeat(48);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const authCode = {
      _id: "native-auth-id",
      sessionId: "session_123",
      userId: "user_123",
      deviceId: "extension-device-123456",
      codeChallenge,
      state: "state_123456789012",
      surface: "browser-extension",
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    };
    const collect = mock().mockResolvedValue([authCode]);
    const patch = mock().mockResolvedValue(null);
    const queryBuilder = {
      eq: mock(() => queryBuilder),
    };
    const runMutation = mock().mockResolvedValue({ _id: "session-doc-id" });
    const ctx = {
      db: {
        patch,
        query: mock().mockReturnValue({
          withIndex: mock((_index, buildQuery) => {
            buildQuery(queryBuilder);
            return { collect };
          }),
        }),
      },
      // Paired web session no longer exists -> SESSION_INVALID contract.
      runQuery: mock().mockResolvedValue(null),
      runMutation,
    };

    await expect(
      getHandler(consumeNativeAuthByState)(ctx, {
        codeVerifier,
        deviceId: "extension-device-123456",
        state: "state_123456789012",
      })
    ).rejects.toThrow();

    // Code is still consumed, but no dedicated session is minted.
    expect(patch).toHaveBeenCalledWith("native-auth-id", {
      consumedAt: expect.any(Number),
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("does not consume expired or reused auth codes", async () => {
    const codeVerifier = "a".repeat(48);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const collect = mock().mockResolvedValue([
      {
        _id: "expired-id",
        sessionId: "session_123",
        userId: "user_123",
        deviceId: "desktop-device-123456",
        codeChallenge,
        state: "state_123456789012",
        surface: "desktop",
        expiresAt: Date.now() - 1,
        createdAt: Date.now() - 10_000,
      },
      {
        _id: "reused-id",
        sessionId: "session_123",
        userId: "user_123",
        deviceId: "desktop-device-123456",
        codeChallenge,
        state: "state_123456789012",
        surface: "desktop",
        expiresAt: Date.now() + 60_000,
        consumedAt: Date.now(),
        createdAt: Date.now(),
      },
    ]);
    const patch = mock().mockResolvedValue(null);
    const queryBuilder = {
      eq: mock(() => queryBuilder),
    };
    const ctx = {
      db: {
        patch,
        query: mock().mockReturnValue({
          withIndex: mock((_index, buildQuery) => {
            buildQuery(queryBuilder);
            return { collect };
          }),
        }),
      },
      runQuery: mock(),
    };

    const result = await getHandler(consumeNativeAuthByState)(ctx, {
      codeVerifier,
      deviceId: "desktop-device-123456",
      state: "state_123456789012",
    });

    expect(result).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  test("native poll endpoint validates payload shape", async () => {
    const response = await getHandler(pollNativeAuthCode)(
      {},
      new Request("https://example.com/api/native/auth/poll", {
        method: "POST",
        body: JSON.stringify({ state: "missing-fields" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  test("native poll endpoint returns 429 when rate limited", async () => {
    const ctx = {
      // consumeNativeAuthPollLimit reports the bucket is empty.
      runMutation: mock().mockResolvedValue({ ok: false, retryAt: 123_456 }),
    };

    const response = await getHandler(pollNativeAuthCode)(
      ctx,
      new Request("https://example.com/api/native/auth/poll", {
        method: "POST",
        body: JSON.stringify({
          codeVerifier: "a".repeat(48),
          deviceId: "extension-device-123456",
          state: "state_123456789012",
        }),
      })
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      retryAt: 123_456,
    });
  });
});
