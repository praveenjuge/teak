import workosTest from "@convex-dev/workos-authkit/test";
import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { seedComponentUser } from "../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const copyPage = internal.migration.copyWorkosNames.copyPage;

const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const owner = (t: Backend, teakUserId: string, fields: Partial<Doc<"users">>) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId,
      email: `${teakUserId}@example.test`,
      emailVerified: true,
      ...fields,
    })
  );
const names = (t: Backend) =>
  t.run(async (ctx) =>
    Object.fromEntries(
      (await ctx.db.query("users").take(10)).map((row) => [
        row.teakUserId,
        row.name ?? null,
      ])
    )
  );

test("copies each component name onto a row without one, page by page, until done", async () => {
  const t = setup();
  const profiles = [
    { teakUserId: "unnamed", firstName: " Ada ", lastName: "Lovelace" },
    { teakUserId: "named", firstName: "Component", lastName: "Name" },
    { teakUserId: "blank", firstName: " ", lastName: null },
    { teakUserId: "first-only", firstName: "Grace", lastName: null },
    // Accounts imported into WorkOS carry only a full name.
    {
      teakUserId: "full-name",
      firstName: null,
      lastName: null,
      name: " Katherine Johnson ",
    },
  ];
  for (const { teakUserId, firstName, lastName, ...rest } of profiles) {
    const workosUserId = `user_${teakUserId.replace("-", "_")}`;
    await owner(t, teakUserId, {
      workosUserId,
      ...(teakUserId === "named" ? { name: "Chosen Name" } : {}),
    });
    await seedComponentUser(t, {
      id: workosUserId,
      email: `${teakUserId}@example.test`,
      firstName,
      lastName,
      ...rest,
    });
  }
  // No WorkOS user, and a WorkOS user the component never stored.
  await owner(t, "legacy", {});
  await owner(t, "no-profile", { workosUserId: "user_no_profile" });

  let cursor: string | null = null;
  let copied = 0;
  let pages = 0;
  for (; pages < 10; pages += 1) {
    const page: FunctionReturnType<typeof copyPage> = await t.mutation(
      copyPage,
      {
        paginationOpts: { numItems: 2, cursor },
      }
    );
    copied += page.copied;
    cursor = page.continueCursor;
    if (page.isDone) {
      break;
    }
  }
  expect(pages).toBeGreaterThan(1);
  expect(copied).toBe(3);
  expect(await names(t)).toEqual({
    unnamed: "Ada Lovelace",
    named: "Chosen Name",
    blank: null,
    "first-only": "Grace",
    "full-name": "Katherine Johnson",
    legacy: null,
    "no-profile": null,
  });

  const rerun = await t.mutation(copyPage, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(rerun).toMatchObject({ copied: 0, isDone: true });
});
