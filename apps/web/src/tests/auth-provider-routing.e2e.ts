import { type APIRequestContext, expect, test } from "@playwright/test";

const redirectTarget = async (request: APIRequestContext, path: string) => {
  const response = await request.get(path, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers().location ?? "", response.url());
  return `${location.pathname}${location.search}`;
};

// Signs nobody in and creates no accounts. The outage case closes only the
// browser's Convex connection.
test.describe("Web sign-in entry", () => {
  test("hands every entry page to hosted AuthKit", async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    // WorkOS hosts every entry: Teak redirects without a page of its own.
    expect(await redirectTarget(request, "/login?next=%2Fsettings")).toBe(
      "/sign-in?next=%2Fsettings"
    );
    expect(await redirectTarget(request, "/forgot-password")).toBe("/sign-in");
    expect(await redirectTarget(request, "/reset-password")).toBe("/sign-in");
    expect(await redirectTarget(request, "/register")).toBe("/sign-up");
    await page.goto("/login?next=%2Fsettings");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    expect(new URL(page.url()).origin).not.toBe(new URL(baseURL ?? "").origin);
    await testInfo.attach("entry-state", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    expect(pageErrors).toEqual([]);
  });
  test("reaches hosted sign-in while Convex is unreachable", async ({
    page,
    baseURL,
  }) => {
    await page.routeWebSocket("**/*.convex.cloud/**", (socket) =>
      socket.close()
    );
    await page.goto("/login");
    // Sign-in starts server-side, so a browser outage can't stop the hand-off.
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    expect(new URL(page.url()).origin).not.toBe(new URL(baseURL ?? "").origin);
  });
});
