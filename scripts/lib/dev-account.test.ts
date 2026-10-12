import { describe, expect, test } from "bun:test";
import { devAccountEmail, devAccountHost } from "./dev-account.ts";

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
