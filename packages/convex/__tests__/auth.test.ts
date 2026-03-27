// @ts-nocheck
import { describe, expect, test } from "bun:test";

describe("auth.ts", () => {
  test("module exports", async () => {
    expect(await import("../auth")).toBeTruthy();
  });

  test("exports current Clerk-backed auth handlers", async () => {
    const module = await import("../auth");

    expect(module.getCurrentUser).toBeDefined();
    expect(module.getCurrentUserHandler).toBeDefined();
    expect(module.deleteAccount).toBeDefined();
    expect(module.deleteAccountHandler).toBeDefined();
    expect(module.ensureCardCreationAllowed).toBeDefined();
  });
});
