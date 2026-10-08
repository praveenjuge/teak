/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => convexTest(schema, modules);
type TestBackend = ReturnType<typeof setup>;
const rows = (t: TestBackend) =>
  t.run((ctx) => ctx.db.query("users").take(200));

// Failure mode: admin role granted to the wrong or no account.
describe("identity table", () => {
  test("admin seeding grants the role to exactly one active account", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "owner",
        identityOrigin: "workos",
        workosUserId: "user_owner",
        email: "owner@example.com",
        emailVerified: true,
      })
    );
    expect(
      await t.mutation(internal.admin.seedAdmin, {
        email: " OWNER@EXAMPLE.COM ",
      })
    ).toEqual({ teakUserId: "owner", role: "admin" });
    expect(await rows(t)).toEqual([
      expect.objectContaining({ teakUserId: "owner", role: "admin" }),
    ]);
  });

  test("admin seeding rejects missing, ambiguous or deleted accounts without granting a role", async () => {
    const t = setup();
    await expect(
      t.mutation(internal.admin.seedAdmin, { email: "duplicate@example.com" })
    ).rejects.toThrow("exactly one active");
    await t.run(async (ctx) => {
      for (const teakUserId of ["first", "second"]) {
        await ctx.db.insert("users", {
          teakUserId,
          email: "duplicate@example.com",
          emailVerified: true,
        });
      }
      await ctx.db.insert("users", {
        teakUserId: "deleted",
        email: "deleted@example.com",
        emailVerified: true,
        deletedAt: Date.now(),
      });
    });
    for (const email of ["duplicate@example.com", "deleted@example.com"]) {
      await expect(
        t.mutation(internal.admin.seedAdmin, { email })
      ).rejects.toThrow("exactly one active");
    }
    expect((await rows(t)).map((row) => row.role)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
