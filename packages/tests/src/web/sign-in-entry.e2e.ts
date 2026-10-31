import { appPath, expectVault, gotoApp, signUp } from "../helpers/app";
import { env } from "../helpers/env";
import { capturePageErrors, routeConvexSocket } from "../helpers/page-hooks";
import { describe, expect, test } from "../helpers/test";

const redirectTarget = async (path: string) => {
  const response = await fetch(appPath(path), { redirect: "manual" });
  expect(response.status).toBe(307);
  const location = new URL(
    response.headers.get("location") ?? "",
    appPath(path)
  );
  return `${location.pathname}${location.search}`;
};

describe("Web sign-in entry", () => {
  test("hands every entry page to hosted AuthKit", async ({
    app,
    browser,
    screen,
  }) => {
    const pageErrors = await capturePageErrors(browser);
    expect(await redirectTarget("/settings")).toBe("/sign-in?next=%2Fsettings");
    await gotoApp(browser, "/settings");
    await expect(screen.getByLabel("Email")).toBeVisible();
    expect(new URL(await browser.url()).origin).not.toBe(
      new URL(env.appUrl).origin
    );
    await app.screenshot("entry-state");
    expect(pageErrors.errors).toEqual([]);
  });

  test("reaches hosted sign-in while Convex is unreachable", async ({
    browser,
    screen,
  }) => {
    await routeConvexSocket(browser, { unreachable: true });
    await gotoApp(browser, "/sign-in");
    await expect(screen.getByLabel("Email")).toBeVisible();
    expect(new URL(await browser.url()).origin).not.toBe(
      new URL(env.appUrl).origin
    );
  });

  test("sends a signed-in visit to sign-in straight to its destination", async ({
    browser,
    screen,
  }) => {
    const surface = { browser, screen };
    await signUp(surface, "entry");
    const pageErrors = await capturePageErrors(browser);
    await gotoApp(browser, "/sign-in?next=%2Fsettings");
    await expect(
      screen.getByRole("heading", "Settings", { level: 1 })
    ).toBeVisible({ timeout: 45_000 });
    expect(new URL(await browser.url()).pathname).toBe("/settings");
    await gotoApp(browser, "/sign-up");
    await expectVault(surface);
    expect(new URL(await browser.url()).pathname).toBe("/");
    expect(pageErrors.errors).toEqual([]);
  });
});
