import { describe, expect, test } from "bun:test";
import {
  type CloudAccountActivity,
  devAccountEmail,
  devAccountHost,
  isCloudSession,
  selectStaleCloudAccounts,
} from "./dev-account.ts";

const cloud = (sessionId: string) => ({
  CLAUDE_CODE_REMOTE: "true",
  CLAUDE_CODE_REMOTE_SESSION_ID: sessionId,
});

describe("dev account email", () => {
  test("names a Mac checkout after its machine and checkout", () => {
    expect(
      devAccountEmail("main", devAccountHost({}, "Praveens-MBP.local"))
    ).toBe("dev+praveens-mbp-main@example.org");
    expect(
      devAccountEmail("wt-3", devAccountHost({}, "Praveens-MBP.local"))
    ).toBe("dev+praveens-mbp-wt-3@example.org");
  });

  test("gives each Claude Code cloud session its own account", () => {
    const first = devAccountEmail(
      "main",
      devAccountHost(cloud("cse_01HjQHZnYynP3UE4H87tQ6uc"), "vm")
    );
    const second = devAccountEmail(
      "main",
      devAccountHost(cloud("cse_01HjQHZnYynP3UE4H87tQ6uC"), "vm")
    );
    expect(first).toMatch(/^dev\+cloud-[0-9a-f]{8}-main@example\.org$/);
    expect(second).toMatch(/^dev\+cloud-[0-9a-f]{8}-main@example\.org$/);
    expect(first).not.toBe(second);
    expect(first).not.toBe("dev+vm-main@example.org");
  });

  test("keeps a cloud session's account when it resumes on a new VM", () => {
    const session = cloud("cse_01HjQHZnYynP3UE4H87tQ6uc");
    expect(devAccountHost(session, "vm")).toBe(
      devAccountHost(session, "other-vm")
    );
  });

  test("falls back to the machine name without a remote session ID", () => {
    expect(devAccountHost({ CLAUDE_CODE_REMOTE: "true" }, "vm")).toBe("vm");
    expect(
      devAccountHost({ CLAUDE_CODE_REMOTE_SESSION_ID: "cse_123" }, "laptop")
    ).toBe("laptop");
  });
});

describe("stale cloud account selection", () => {
  const now = Date.parse("2026-10-12T12:00:00.000Z");
  const daysAgo = (days: number) =>
    new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const current = {
    email: "dev+cloud-00000000-main@example.org",
    workosUserId: "user_CURRENT",
  };
  const account = (
    hash: string,
    activity: Partial<CloudAccountActivity>
  ): CloudAccountActivity => ({
    createdAt: daysAgo(30),
    email: `dev+cloud-${hash}-main@example.org`,
    lastSignInAt: null,
    workosUserId: `user_${hash}`,
    ...activity,
  });
  const select = (accounts: CloudAccountActivity[]) =>
    selectStaleCloudAccounts(accounts, { current, now }).map(
      (stale) => stale.email
    );

  test("prunes accounts last signed in to more than 14 days ago", () => {
    expect(
      select([
        account("aaaaaaaa", { lastSignInAt: daysAgo(15) }),
        account("bbbbbbbb", { lastSignInAt: daysAgo(13) }),
      ])
    ).toEqual(["dev+cloud-aaaaaaaa-main@example.org"]);
  });

  test("judges a never-used account by when it was created", () => {
    expect(
      select([
        account("aaaaaaaa", { createdAt: daysAgo(20) }),
        account("bbbbbbbb", { createdAt: daysAgo(2) }),
      ])
    ).toEqual(["dev+cloud-aaaaaaaa-main@example.org"]);
  });

  test("keeps an old account that was signed in to recently", () => {
    expect(
      select([
        account("aaaaaaaa", {
          createdAt: daysAgo(90),
          lastSignInAt: daysAgo(1),
        }),
      ])
    ).toEqual([]);
  });

  test("never prunes the current session's account", () => {
    expect(
      select([
        { ...current, createdAt: daysAgo(60), lastSignInAt: daysAgo(30) },
        account("aaaaaaaa", {
          workosUserId: current.workosUserId,
          lastSignInAt: daysAgo(30),
        }),
      ])
    ).toEqual([]);
  });

  test.each([
    "dev+praveens-mbp-main@example.org",
    "dev+vm-main@example.org",
    "dev+cloud-abc-main@example.org",
    "dev+cloud-aaaaaaaa-main@example.org.evil.test",
    "someone@example.org",
  ])("never prunes %s", (email) => {
    expect(
      select([account("aaaaaaaa", { email, lastSignInAt: daysAgo(30) })])
    ).toEqual([]);
  });

  test("keeps an account whose dates don't parse", () => {
    expect(select([account("aaaaaaaa", { createdAt: "not a date" })])).toEqual(
      []
    );
  });
});

describe("cloud session detection", () => {
  test("is a cloud session only with a remote session ID", () => {
    expect(isCloudSession(cloud("cse_01HjQHZnYynP3UE4H87tQ6uc"))).toBe(true);
    expect(isCloudSession({ CLAUDE_CODE_REMOTE: "true" })).toBe(false);
    expect(isCloudSession({ CLAUDE_CODE_REMOTE_SESSION_ID: "cse_123" })).toBe(
      false
    );
    expect(isCloudSession({})).toBe(false);
  });
});
