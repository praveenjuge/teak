import { expect, test } from "@playwright/test";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";

const email = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const password = process.env.E2E_BETTER_AUTH_USER_PASSWORD;
const owner = process.env.E2E_BETTER_AUTH_USER_ID;

test.use({ trace: "off", video: "off", screenshot: "off" });

test("keeps the authenticated vault usable during development effect replay", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !(email && password && owner),
    "Requires an existing controlled dev account."
  );
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (
    !(
      baseURL &&
      ["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname) &&
      convexUrl &&
      process.env.CONVEX_DEPLOYMENT?.startsWith("dev:")
    )
  ) {
    throw new Error("Requires a local app against its development backend.");
  }
  const client = new ConvexHttpClient(convexUrl);
  expect((await client.query(api.auth.getAuthMode, {})).primary).toBe(
    "betterauth"
  );
  const closedClientErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("ConvexReactClient has already been closed")) {
      closedClientErrors.push(error.message);
    }
  });
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Login", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(
      page.getByRole("textbox", { name: "Markdown content" })
    ).toBeVisible();
    const tokenResponse = await page.request.get("/api/auth/convex/token");
    expect(tokenResponse.ok()).toBe(true);
    const { token } = await tokenResponse.json();
    client.setAuth(token);
    expect((await client.query(api.auth.getCurrentUser, {}))?._id).toBe(owner!);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Markdown content" })
    ).toBeVisible();
    expect(closedClientErrors).toEqual([]);
  } finally {
    await page.request.post("/api/auth/sign-out", {
      data: {},
      headers: { Origin: baseURL },
    });
  }
});
