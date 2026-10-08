import { instant } from "@next/playwright";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";

const readMode = () => {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error(
      "Configure the isolated development backend before this test."
    );
  }
  return new ConvexHttpClient(convexUrl).query(api.auth.getAuthMode, {});
};

const redirectTarget = async (request: APIRequestContext, path: string) => {
  const response = await request.get(path, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers().location ?? "", response.url());
  return `${location.pathname}${location.search}`;
};

// Uses the running backend's public authority without creating accounts or
// changing the auth mode. The outage case closes only the browser network.
test.describe("Selected web authentication", () => {
  test("keeps selected sign-in, freeze, and recovery behavior visible", async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    const mode = await readMode();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    if (mode.primary === "betterauth") {
      await page.goto("/login?next=%2Fsettings");
      await expect(
        page.getByText("Login to Teak", { exact: true })
      ).toBeVisible();
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
      await page.goto("/register");
      await expect(
        mode.signupsDisabled
          ? page
              .getByRole("status")
              .filter({ hasText: /sign.?ups are paused/i })
          : page.getByLabel("Email", { exact: true })
      ).toBeVisible();
    } else {
      // WorkOS hosts every entry: Teak redirects without a page of its own.
      expect(await redirectTarget(request, "/login?next=%2Fsettings")).toBe(
        "/sign-in?next=%2Fsettings"
      );
      expect(await redirectTarget(request, "/forgot-password")).toBe(
        "/sign-in"
      );
      expect(await redirectTarget(request, "/register")).toBe("/sign-up");
      await page.goto("/login?next=%2Fsettings");
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      expect(new URL(page.url()).origin).not.toBe(
        new URL(baseURL ?? "").origin
      );
    }
    await testInfo.attach("selected-provider", {
      body: JSON.stringify(mode),
      contentType: "application/json",
    });
    await testInfo.attach("entry-state", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    expect(pageErrors).toEqual([]);
  });
  test("survives an unreachable public session authority", async ({
    page,
    baseURL,
  }, testInfo) => {
    const mode = await readMode();
    await page.routeWebSocket("**/*.convex.cloud/**", (socket) =>
      socket.close()
    );
    await page.goto("/login");
    if (mode.primary === "workos") {
      // The proxy reads the authority server-side, so a browser outage can't
      // stop the hand-off to hosted sign-in.
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      expect(new URL(page.url()).origin).not.toBe(
        new URL(baseURL ?? "").origin
      );
      return;
    }
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
