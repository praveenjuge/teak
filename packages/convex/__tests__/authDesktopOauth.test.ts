// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { consumeOAuthTokenForSession } from "../authDesktopOauth";

const runHandler = (fn: any, ctx: any, args: any) =>
  (fn.handler ?? fn)(ctx, args);

const accessToken = "a".repeat(32);

describe("consumeOAuthTokenForSession", () => {
  test("mints a dedicated session for a valid desktop token and consumes it", async () => {
    const runQuery = mock().mockResolvedValueOnce({
      _id: "t1",
      accessTokenExpiresAt: Date.now() + 60_000,
      clientId: "teak-desktop",
      userId: "user_1",
    });
    const runMutation = mock()
      // deleteOne (single-use)...
      .mockResolvedValueOnce(undefined)
      // ...then session create.
      .mockResolvedValueOnce({ _id: "session_1" });

    const result = await runHandler(
      consumeOAuthTokenForSession,
      { runMutation, runQuery },
      { accessToken }
    );

    expect(result).not.toBeNull();
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(typeof result.expiresAt).toBe("number");

    // Delete precedes create, and the session is stamped as a desktop session.
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0][1].input.model).toBe("oauthAccessToken");
    const createArg = runMutation.mock.calls[1][1];
    expect(createArg.input.model).toBe("session");
    expect(createArg.input.data.userId).toBe("user_1");
    expect(createArg.input.data.userAgent).toBe("Teak Desktop");
  });

  test("rejects a non-desktop client token (Raycast/MCP cannot become a session)", async () => {
    const runQuery = mock().mockResolvedValueOnce({
      _id: "t1",
      accessTokenExpiresAt: Date.now() + 60_000,
      clientId: "teak-raycast",
      userId: "user_1",
    });
    const runMutation = mock();

    const result = await runHandler(
      consumeOAuthTokenForSession,
      { runMutation, runQuery },
      { accessToken }
    );

    expect(result).toBeNull();
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("rejects an expired token", async () => {
    const runQuery = mock().mockResolvedValueOnce({
      _id: "t1",
      accessTokenExpiresAt: Date.now() - 1,
      clientId: "teak-desktop",
      userId: "user_1",
    });
    const runMutation = mock();

    const result = await runHandler(
      consumeOAuthTokenForSession,
      { runMutation, runQuery },
      { accessToken }
    );

    expect(result).toBeNull();
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns null when the token row is missing (replayed or already consumed)", async () => {
    const runQuery = mock().mockResolvedValueOnce(null);
    const runMutation = mock();

    const result = await runHandler(
      consumeOAuthTokenForSession,
      { runMutation, runQuery },
      { accessToken }
    );

    expect(result).toBeNull();
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("rejects a malformed access token without touching the database", async () => {
    const runQuery = mock();
    const runMutation = mock();

    const result = await runHandler(
      consumeOAuthTokenForSession,
      { runMutation, runQuery },
      { accessToken: "short" }
    );

    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });
});
