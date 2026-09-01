import { createHash, randomBytes } from "node:crypto";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { apiFetch } from "../helpers/api";
import { cleanupE2EAccounts } from "../helpers/e2e-cleanup";
import { env } from "../helpers/env";
import {
  clientFor,
  createAccount,
  generateApiKey,
  newAnonymousContext,
  revokeVisibleKey,
} from "../helpers/prod";
import { readState } from "../helpers/run-state";

test("native pairing shows an approve step instead of minting on GET", async ({
  page,
}) => {
  const start = new URL("/native/auth/start", env.appUrl);
  start.search = new URLSearchParams({
    code_challenge: "a".repeat(43),
    device_id: "e2e-device-1234567",
    redirect_uri: `${env.appUrl.replace(/\/$/, "")}/native/auth/complete`,
    state: "state_e2e_pairing_ok",
    surface: "desktop",
  }).toString();

  await page.goto(start.toString());
  await expect(
    page.getByRole("button", { name: "Approve device" })
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/native\/auth\/complete/);
});

test("external OAuth requires explicit full-vault consent and can be revoked", async ({
  page,
}) => {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "https://oauth-e2e.invalid/callback";
  const clientName = `OAuth security e2e ${Date.now()}`;
  // This project uses an authenticated storage state for the whole journey.
  // Dynamic client registration is anonymous, so create a truly empty request
  // context instead of inheriting those cookies and triggering the CSRF guard.
  const anonymousRequest = await playwrightRequest.newContext({
    baseURL: env.appUrl,
    storageState: { cookies: [], origins: [] },
  });
  let clientId = "";
  try {
    const registration = await anonymousRequest.post("/api/auth/mcp/register", {
      data: {
        client_name: clientName,
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [redirectUri],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    });
    const registrationBody = (await registration.json()) as {
      client_id?: string;
      message?: string;
    };
    expect(registration.status(), registrationBody.message).toBe(201);
    clientId = registrationBody.client_id ?? "";
    expect(clientId).toBeTruthy();
  } finally {
    await anonymousRequest.dispose();
  }

  let callbackUrl = "";
  await page.route("https://oauth-e2e.invalid/**", async (route) => {
    callbackUrl = route.request().url();
    await route.fulfill({ body: "OAuth callback received", status: 200 });
  });
  const authorize = new URL("/api/auth/mcp/authorize", env.appUrl);
  authorize.search = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email offline_access",
    state: "oauth-security-e2e",
  }).toString();
  await page.goto(authorize.toString());
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(clientName)).toBeVisible({ timeout: 5000 });
  }).toPass({ intervals: [500, 1000, 2000], timeout: 15_000 });
  await expect(
    page.getByText(/read, create, edit, and delete your cards/i)
  ).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => callbackUrl).toContain("code=");

  const code = new URL(callbackUrl).searchParams.get("code");
  expect(code).toBeTruthy();
  const tokenRequest = await playwrightRequest.newContext({
    baseURL: env.appUrl,
    storageState: { cookies: [], origins: [] },
  });
  let tokens: { access_token: string };
  try {
    const tokenResponse = await tokenRequest.post("/api/auth/mcp/token", {
      form: {
        client_id: clientId,
        code: code!,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      },
    });
    const tokenBody = (await tokenResponse.json()) as {
      access_token?: string;
      error_description?: string;
    };
    expect(tokenResponse.ok(), tokenBody.error_description).toBe(true);
    expect(tokenBody.access_token).toBeTruthy();
    tokens = { access_token: tokenBody.access_token! };
  } finally {
    await tokenRequest.dispose();
  }
  expect((await apiFetch("/v1/tags", tokens.access_token)).status).toBe(200);

  await page.goto("/settings");
  await page
    .getByText("Connected apps")
    .locator("xpath=ancestor::div[.//button][1]")
    .getByRole("button", { name: "Manage" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Connected apps" });
  await expect(dialog.getByText(clientName)).toBeVisible();
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(dialog.getByText(clientName)).not.toBeVisible();
  await expect
    .poll(async () => (await apiFetch("/v1/tags", tokens.access_token)).status)
    .toBe(401);
});

test("cross-tenant, revoked-key, hostile input, headers, and cookie security", async ({
  browser,
  page,
  context,
}) => {
  const state = readState();
  const securityApiKey = await generateApiKey(page);
  const secondContext = await newAnonymousContext(browser);
  const secondPage = await secondContext.newPage();
  const second = await createAccount(secondPage, "tenant-b", {
    remember: false,
  });
  try {
    const targetCard = state.createdCardIds[0];
    expect(
      targetCard,
      "web-core should have created a card before security checks"
    ).toBeTruthy();
    expect(
      (await apiFetch(`/v1/cards/${targetCard!}`, second.apiKey!)).status
    ).toBe(404);
    expect(state.revokedKey, "web-core should have revoked a key").toBeTruthy();
    expect((await apiFetch("/v1/tags", state.revokedKey!)).status).toBe(401);
    const hostile = `<img src=x onerror="window.__teakXss=1"> javascript:alert(1) שלום ${"x".repeat(100_000)}`;
    await clientFor(securityApiKey).cards.create({
      content: hostile,
      source: "prod-e2e",
      tags: ["xss"],
    });
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => (window as any).__teakXss))
      .toBeUndefined();
    for (const url of ["/login", "/settings"]) {
      const response = await page.goto(url);
      expect(response?.headers()["strict-transport-security"]).toBeTruthy();
      const csp = response?.headers()["content-security-policy"] ?? "";
      expect(csp).toBeTruthy();
      // Regression: images (link previews, PDF thumbnails) are served from R2.
      // The CSP img-src must allow that origin or they are blocked outright.
      const imgSrc = csp
        .split(";")
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith("img-src"));
      expect(imgSrc).toBeTruthy();
      expect(imgSrc).toContain("r2.cloudflarestorage.com");
    }
    const cookies = await context.cookies();
    expect(
      cookies.some(
        (cookie) => cookie.secure && cookie.httpOnly && cookie.sameSite
      )
    ).toBe(true);
  } finally {
    try {
      await revokeVisibleKey(page, securityApiKey);
    } finally {
      await secondContext.close();
      await cleanupE2EAccounts([second.email]);
    }
  }
});
