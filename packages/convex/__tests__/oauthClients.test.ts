// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { ensureOAuthClients, FIRST_PARTY_OAUTH_CLIENTS } from "../oauthClients";

const runHandler = (fn: any, ctx: any, args: any) =>
  (fn._handler ?? fn.handler ?? fn)(ctx, args);

describe("ensureOAuthClients", () => {
  test("creates all first-party clients when none exist", async () => {
    const runQuery = mock().mockResolvedValue(null);
    const runMutation = mock().mockResolvedValue(undefined);

    const result = await runHandler(
      ensureOAuthClients,
      { runMutation, runQuery },
      {}
    );

    expect(result).toMatchObject({
      created: FIRST_PARTY_OAUTH_CLIENTS.length,
      updated: 0,
    });
    expect(runMutation).toHaveBeenCalledTimes(FIRST_PARTY_OAUTH_CLIENTS.length);

    const first = runMutation.mock.calls[0][1];
    expect(first.input.model).toBe("oauthApplication");
    expect(first.input.data.type).toBe("public");
    expect(first.input.data.clientId).toBe("teak-raycast");
    // redirectUrls is stored as a comma-joined string.
    expect(first.input.data.redirectUrls).toContain(",");
    expect(first.input.data).not.toHaveProperty("skipConsent");
  });

  test("repairs existing clients without creating duplicates", async () => {
    const runQuery = mock().mockResolvedValue({ _id: "app_1", clientId: "x" });
    const runMutation = mock().mockResolvedValue(undefined);

    const result = await runHandler(
      ensureOAuthClients,
      { runMutation, runQuery },
      {}
    );

    expect(result).toMatchObject({
      created: 0,
      updated: FIRST_PARTY_OAUTH_CLIENTS.length,
    });
    expect(runMutation.mock.calls[0][1].input.update.type).toBe("public");
    expect(runMutation.mock.calls[0][1].input.update).not.toHaveProperty(
      "skipConsent"
    );
    // The immutable clientId is not part of the update payload.
    expect(runMutation.mock.calls[0][1].input.update.clientId).toBeUndefined();
  });

  test("leaves matching clients untouched even when their timestamps differ", async () => {
    const runQuery = mock().mockImplementation((_ref, args) => {
      const client = FIRST_PARTY_OAUTH_CLIENTS.find(
        (value) => value.clientId === args.where[0].value
      );
      return Promise.resolve({
        clientId: client.clientId,
        clientSecret: "",
        createdAt: 1,
        disabled: false,
        metadata: null,
        name: client.name,
        redirectUrls: client.redirectUrls.join(","),
        type: "public",
        updatedAt: 1,
        userId: null,
      });
    });
    const runMutation = mock().mockResolvedValue(undefined);
    const result = await runHandler(
      ensureOAuthClients,
      { runMutation, runQuery },
      {}
    );
    expect(result).toMatchObject({ created: 0, updated: 0 });
    expect(runMutation).not.toHaveBeenCalled();
  });

  for (const [field, drift] of Object.entries({
    clientSecret: "unexpected-secret",
    disabled: true,
    metadata: "unexpected-metadata",
    name: "Outdated name",
    redirectUrls: "https://unexpected.example/callback",
    type: "confidential",
    userId: "unexpected-owner",
  })) {
    test(`repairs ${field} drift on only the affected client`, async () => {
      const rows = new Map(
        FIRST_PARTY_OAUTH_CLIENTS.map((client) => [
          client.clientId,
          {
            clientSecret: "",
            disabled: false,
            metadata: null,
            name: client.name,
            redirectUrls: client.redirectUrls.join(","),
            type: "public",
            updatedAt: 1,
            userId: null,
          },
        ])
      );
      const configuredRow = { ...rows.get("teak-cli") };
      rows.get("teak-cli")[field] = drift;
      const runQuery = mock().mockImplementation((_ref, args) =>
        Promise.resolve(rows.get(args.where[0].value))
      );
      const runMutation = mock().mockImplementation((_ref, args) => {
        const { update, where } = args.input;
        Object.assign(rows.get(where[0].value), update);
        return Promise.resolve(undefined);
      });
      const result = await runHandler(
        ensureOAuthClients,
        { runMutation, runQuery },
        {}
      );
      expect(result).toMatchObject({ created: 0, updated: 1 });
      expect(runMutation).toHaveBeenCalledTimes(1);
      expect(runMutation.mock.calls[0][1].input.where[0].value).toBe(
        "teak-cli"
      );
      expect(
        runMutation.mock.calls[0][1].input.update.updatedAt
      ).toBeGreaterThan(1);
      expect(rows.get("teak-cli")).toEqual({
        ...configuredRow,
        updatedAt: expect.any(Number),
      });

      // A repaired row must stay unchanged on the next cron execution.
      // Leaving even one configured field wrong would trigger another update.
      const secondResult = await runHandler(
        ensureOAuthClients,
        { runMutation, runQuery },
        {}
      );
      expect(secondResult).toMatchObject({ created: 0, updated: 0 });
      expect(runMutation).toHaveBeenCalledTimes(1);
    });
  }

  test("seeds teak-desktop with both loopback callback ports", () => {
    const desktop = FIRST_PARTY_OAUTH_CLIENTS.find(
      (client) => client.clientId === "teak-desktop"
    );
    expect(desktop?.redirectUrls).toEqual([
      "http://127.0.0.1:14203/oauth/callback",
      "http://127.0.0.1:24203/oauth/callback",
    ]);
  });

  test("seeds Safari as a public client with an exact callback", () => {
    expect(
      FIRST_PARTY_OAUTH_CLIENTS.find(
        (client) => client.clientId === "teak-safari"
      )
    ).toEqual({
      clientId: "teak-safari",
      name: "Teak Safari",
      redirectUrls: ["teak-safari://oauth/callback"],
    });
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
