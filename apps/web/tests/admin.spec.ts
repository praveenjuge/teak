import { expect, test } from "@playwright/test";
// import { clerk } from "@clerk/testing/playwright";

const shouldSkipGlobal =
  process.env.PLAYWRIGHT_CLERK_SETUP_SKIPPED === "true";

test.describe("Admin dashboard", () => {
  test.skip(
    shouldSkipGlobal,
    "Clerk testing credentials are not configured for Playwright.",
  );

  const nonAdminEmail = process.env.E2E_CLERK_USER_EMAIL;
  const nonAdminPassword = process.env.E2E_CLERK_USER_PASSWORD;

  test("blocks non-admin members from reaching the admin page", async ({
    page,
  }) => {
    test.skip(
      !nonAdminEmail || !nonAdminPassword,
      "Set E2E_CLERK_USER_EMAIL and E2E_CLERK_USER_PASSWORD for non-admin tests.",
    );

    await page.goto("/login");

    // await clerk.signIn({
    //   page,
    //   signInParams: {
    //     strategy: "password",
    //     identifier: nonAdminEmail!,
    //     password: nonAdminPassword!,
    //   },
    // });

    await page.goto("/admin");

    await page.waitForURL("**/");

    await expect(
      page.getByRole("searchbox", { name: /search for anything/i }),
    ).toBeVisible();
    // await clerk.signOut({ page });
  });

  const adminEmail = process.env.E2E_CLERK_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_CLERK_ADMIN_PASSWORD;

  test("renders admin metrics and exposes enrichment controls", async ({
    page,
  }) => {
    test.skip(
      !adminEmail || !adminPassword,
      "Set E2E_CLERK_ADMIN_EMAIL and E2E_CLERK_ADMIN_PASSWORD to run admin feature tests.",
    );

    await page.goto("/login");
    // await clerk.signIn({
    //   page,
    //   signInParams: {
    //     strategy: "password",
    //     identifier: adminEmail!,
    //     password: adminPassword!,
    //   },
    // });

    await page.goto("/admin");

    await expect(
      page.getByRole("heading", { name: /admin control center/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /cards pending ai enrichment/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/ai enrichment health/i),
    ).toBeVisible();

    // await clerk.signOut({ page });
  });
});
