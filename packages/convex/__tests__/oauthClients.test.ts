// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { ensureOAuthClients, FIRST_PARTY_OAUTH_CLIENTS } from "../oauthClients";

const runHandler = (fn: any, ctx: any, args: any) =>
  (fn.handler ?? fn)(ctx, args);

describe("ensureOAuthClients", () => {
  test("creates both first-party clients when none exist", async () => {
    const runQuery = mock().mockResolvedValue(null);
    const runMutation = mock().mockResolvedValue(undefined);

    const result = await runHandler(
      ensureOAuthClients,
      { runMutation, runQuery },
      {}
    );

    expect(result).toMatchObject({ created: 3, updated: 0 });
    expect(runMutation).toHaveBeenCalledTimes(3);

    const first = runMutation.mock.calls[0][1];
    expect(first.input.model).toBe("oauthApplication");
    expect(first.input.data.type).toBe("public");
    expect(first.input.data.clientId).toBe("teak-raycast");
    // redirectUrls is stored as a comma-joined string.
    expect(first.input.data.redirectUrls).toContain(",");
  });

  test("updates clients that already exist (idempotent, no duplicates)", async () => {
    const runQuery = mock().mockResolvedValue({ _id: "app_1", clientId: "x" });
    const runMutation = mock().mockResolvedValue(undefined);

    const result = await runHandler(
      ensureOAuthClients,
      { runMutation, runQuery },
      {}
    );

    expect(result).toMatchObject({ created: 0, updated: 3 });
    expect(runMutation.mock.calls[0][1].input.update.type).toBe("public");
    // The immutable clientId is not part of the update payload.
    expect(runMutation.mock.calls[0][1].input.update.clientId).toBeUndefined();
  });

  test("seeds teak-desktop with both loopback callback ports", () => {
    const desktop = FIRST_PARTY_OAUTH_CLIENTS.find(
      (client) => client.clientId === "teak-desktop"
    );
    expect(desktop?.redirectUrls).toEqual([
      "http://127.0.0.1:14203/oauth/callback",
      "http://127.0.0.1:24203/oauth/callback",
    ]);
  });

  test("seeds teak-cli with both loopback callback ports", () => {
    const cli = FIRST_PARTY_OAUTH_CLIENTS.find(
      (client) => client.clientId === "teak-cli"
    );
    expect(cli?.redirectUrls).toEqual([
      "http://127.0.0.1:14210/oauth/callback",
      "http://127.0.0.1:24210/oauth/callback",
    ]);
  });
});
