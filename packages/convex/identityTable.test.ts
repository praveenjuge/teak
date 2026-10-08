/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { createFunctionHandle } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
};
type TestBackend = ReturnType<typeof setup>;
// Seeds a retained Better Auth row the way pre-WorkOS sign-ups left them.
const retainedUser = (t: TestBackend, email: string) =>
  t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Retained fixture",
          email,
          emailVerified: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
  );
const rows = (t: TestBackend) =>
  t.run((ctx) => ctx.db.query("users").take(200));

// Failure modes: account deletion leaving the email readable; new writes to
// retained Better Auth data; admin role granted to the wrong or no account.
describe("identity table", () => {
  test("deleting a retained Better Auth user records a redacted tombstone", async () => {
    const t = setup();
    const user = await retainedUser(t, "retained@example.com");
    await t.run(async (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: "user", where: [{ field: "_id", value: user._id }] },
        onDeleteHandle: await createFunctionHandle(internal.auth.onDelete),
      })
    );
    expect(await rows(t)).toEqual([
      expect.objectContaining({
        teakUserId: user._id,
        email: "",
        emailVerified: false,
        deletedAt: expect.any(Number),
      }),
    ]);
  });

  test("retained Better Auth data rejects new and updated rows", async () => {
    const t = setup();
    const user = await retainedUser(t, "retained@example.com");
    await expect(
      t.run(async (ctx) =>
        ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "session",
            data: {
              userId: user._id,
              token: crypto.randomUUID(),
              expiresAt: Date.now() + 60_000,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
          onCreateHandle: await createFunctionHandle(internal.auth.onCreate),
        })
      )
    ).rejects.toThrow("Better Auth data is read-only");
    await expect(
      t.mutation(internal.auth.onUpdate, {
        model: "user",
        oldDoc: user,
        newDoc: { ...user, email: "changed@example.com" },
      })
    ).rejects.toThrow("Better Auth data is read-only");
  });

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
