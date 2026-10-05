import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";

// Uses the running backend's public authority without creating accounts or
// changing the auth mode. The outage case closes only the browser network.
test.describe("Selected web authentication", () => {
  test("keeps selected sign-in, freeze, and recovery behavior visible", async ({
    page,
    request,
  }, testInfo) => {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      throw new Error(
        "Configure the isolated development backend before this test."
      );
    }
    const mode = await new ConvexHttpClient(convexUrl).query(
      api.auth.getAuthMode,
      {}
    );
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/login?next=%2Fsettings");
    await expect(
      page.getByText("Login to Teak", { exact: true })
    ).toBeVisible();
    if (mode.primary === "betterauth") {
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /continue with google/i })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /continue with apple/i })
      ).toBeVisible();
      await instant(page, async () => {
        await page.getByRole("link", { name: "Forgot?", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Send reset link", exact: true })
        ).toBeVisible();
      });
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(
        page.getByLabel("Password", { exact: true }).filter({ visible: true })
      ).toHaveCount(0);
      const callback = await request.get("/callback?code=expired");
      expect(callback.status()).toBe(409);
      expect(callback.headers()["cache-control"]).toBe("no-store");
    } else {
      await expect(
        page.getByRole("button", { name: "Continue", exact: true })
      ).toBeVisible();
      await expect(
        page.getByLabel("Password", { exact: true }).filter({ visible: true })
      ).toHaveCount(0);
    }
    await page.goto("/register");
    if (mode.signupsDisabled) {
      await expect(
        page.getByRole("status").filter({ hasText: /sign.?ups are paused/i })
      ).toContainText(/sign.?ups are paused/i);
      await expect(
        page.getByLabel("Email", { exact: true }).filter({ visible: true })
      ).toHaveCount(0);
    } else if (mode.primary === "betterauth") {
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    } else {
      await expect(
        page.getByRole("button", { name: "Continue", exact: true })
      ).toBeVisible();
    }
    await testInfo.attach("selected-provider", {
      body: JSON.stringify(mode),
      contentType: "application/json",
    });
    await testInfo.attach("signup-state", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    expect(pageErrors).toEqual([]);
  });
  test("shows a retry when the public session authority is unreachable", async ({
    page,
  }, testInfo) => {
    await page.routeWebSocket("**/*.convex.cloud/**", (socket) =>
      socket.close()
    );
    await page.goto("/login");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "We couldn't check your session" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByLabel("Password", { exact: true }).filter({ visible: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Try again", exact: true })
    ).toBeVisible();
    await testInfo.attach("authority-unavailable", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
      page.getByRole("status", { name: "Loading authentication", exact: true })
    ).toBeVisible();
  });
});
