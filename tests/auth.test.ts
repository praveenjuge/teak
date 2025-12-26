// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";

describe("auth.ts", () => {
  test("module exports", async () => {
    mock.module("@convex-dev/resend", () => ({
      Resend: class {
        sendEmail = mock().mockResolvedValue({ id: "test" });
      },
    }));
    mock.module("@convex-dev/better-auth/utils", () => ({
      requireActionCtx: (ctx: any) => ctx,
      isRunMutationCtx: () => true,
      isRunQueryCtx: () => true,
      isActionCtx: () => true,
    }));

    const module = await import("../convex/auth");
    expect(module).toBeTruthy();
  });
});
