import { expect, test } from "@playwright/test";

// TODO: add a Better Auth Playwright helper for signing in/out test users.

test.describe("Admin dashboard", () => {
  const nonAdminEmail = process.env.E2E_BETTER_AUTH_USER_EMAIL;
  const nonAdminPassword = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

  test("blocks non-admin members from reaching the admin page", async ({
    page,
  }) => {
    test.skip(
      !nonAdminEmail || !nonAdminPassword,
      "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD for non-admin tests.",
    );

    await page.goto("/login");

    // await authHelper.signIn({ page, email: nonAdminEmail!, password: nonAdminPassword! });

    await page.goto("/admin");

    await page.waitForURL("**/");

    await expect(
      page.getByRole("searchbox", { name: /search for anything/i }),
    ).toBeVisible();
    // await authHelper.signOut({ page });
  });

  const adminEmail = process.env.E2E_BETTER_AUTH_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_BETTER_AUTH_ADMIN_PASSWORD;

  test("renders admin metrics and exposes enrichment controls", async ({
    page,
  }) => {
    test.skip(
      !adminEmail || !adminPassword,
      "Set E2E_BETTER_AUTH_ADMIN_EMAIL and E2E_BETTER_AUTH_ADMIN_PASSWORD to run admin feature tests.",
    );

    await page.goto("/login");
    // await authHelper.signIn({ page, email: adminEmail!, password: adminPassword! });

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

    // await authHelper.signOut({ page });
  });
});
