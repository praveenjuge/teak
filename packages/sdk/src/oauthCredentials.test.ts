import { describe, expect, test } from "bun:test";
import {
  isRefreshTokenDead,
  isWorkosCredential,
  matchesBinding,
  refreshAndSave,
} from "./oauthCredentials";

const current = {
  origin: "https://teakvault.com/api",
  issuer: "https://auth.teakvault.com",
  clientId: "client_cli",
};

describe("isWorkosCredential", () => {
  test("accepts a credential bound to a WorkOS client", () => {
    expect(isWorkosCredential(current)).toBe(true);
  });

  test.each([
    ["unbound", undefined],
    ["Better Auth client", { ...current, clientId: "teak-cli" }],
    ["missing issuer", { ...current, issuer: "" }],
    ["missing origin", { ...current, origin: undefined }],
  ])(
    "treats a %s credential as pre-WorkOS",
    (_label: string, saved?: Partial<typeof current>) => {
      expect(isWorkosCredential(saved)).toBe(false);
    }
  );
});

describe("matchesBinding", () => {
  test("matches only the deployment, issuer and client that issued it", () => {
    expect(matchesBinding({ ...current }, current)).toBe(true);
    expect(matchesBinding(undefined, current)).toBe(false);
    expect(
      matchesBinding({ ...current, origin: "https://other.example" }, current)
    ).toBe(false);
    expect(
      matchesBinding({ ...current, issuer: "https://other.example" }, current)
    ).toBe(false);
    expect(
      matchesBinding({ ...current, clientId: "client_beta" }, current)
    ).toBe(false);
  });
});

describe("isRefreshTokenDead", () => {
  test("is true only when the server proved the refresh token dead", () => {
    expect(
      isRefreshTokenDead({
        ok: false,
        reason: "refresh_token_rejected",
        status: 400,
      })
    ).toBe(true);
    for (const reason of [
      "client_rejected",
      "rejected",
      "failed",
      "invalid_response",
    ] as const) {
      expect(isRefreshTokenDead({ ok: false, reason, status: 400 })).toBe(
        false
      );
    }
    expect(
      isRefreshTokenDead({
        ok: true,
        tokens: {
          accessToken: "a",
          refreshToken: "r",
          expiresAt: 0,
          expiresIn: 1,
        },
      })
    ).toBe(false);
  });
});

describe("refreshAndSave", () => {
  test("saves rotated credentials before the caller continues", async () => {
    const events: string[] = [];
    const renewed = await refreshAndSave(
      () => {
        events.push("refresh");
        return Promise.resolve({ refreshToken: "rotated" });
      },
      async (value) => {
        await Promise.resolve();
        events.push(`save:${value.refreshToken}`);
      }
    );
    events.push("continue");
    expect(renewed).toEqual({ refreshToken: "rotated" });
    expect(events).toEqual(["refresh", "save:rotated", "continue"]);
  });

  test("saves nothing when the refresh returns no credentials", async () => {
    let saved = false;
    expect(
      await refreshAndSave(
        () => Promise.resolve(null),
        () => {
          saved = true;
        }
      )
    ).toBeNull();
    expect(saved).toBe(false);
  });

  test("propagates a failed save instead of returning unsaved credentials", async () => {
    await expect(
      refreshAndSave(
        () => Promise.resolve({ refreshToken: "rotated" }),
        () => {
          throw new Error("disk full");
        }
      )
    ).rejects.toThrow("disk full");
  });
});
