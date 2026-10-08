import { apiFetch } from "../helpers/api";
import {
  clientFor,
  createAccount,
  generateApiKey,
  newAnonymousContext,
  revokeVisibleKey,
} from "../helpers/app";
import { readState } from "../helpers/run-state";
import { expect, test } from "../helpers/test";

test("cross-tenant, revoked-key, hostile input, headers, and cookie security", async ({
  browser,
  page,
  context,
}) => {
  const state = readState();
  const securityApiKey = await generateApiKey(page);
  const secondContext = await newAnonymousContext(browser);
  const secondPage = await secondContext.newPage();
  const second = await createAccount(secondPage, "tenant-b");
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
      source: "e2e",
      tags: ["xss"],
    });
    await page.goto("/");
    // The hostile card has rendered, and its markup did not run.
    await expect(
      page
        .getByRole("main")
        .getByText(/javascript:alert\(1\)/)
        .first()
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).__teakXss)
    ).toBeUndefined();
    // Headers come from plain requests: navigating away while the page is
    // still refreshing its session would race the rotated refresh token.
    for (const url of ["/login", "/settings"]) {
      const response = await context.request.get(url);
      expect(response.headers()["strict-transport-security"]).toBeTruthy();
      const csp = response.headers()["content-security-policy"] ?? "";
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
    // The local stack serves http, so the session cookie can't be Secure
    // here; authkit-nextjs sets Secure from an https redirect URI.
    const session = (await context.cookies()).find(
      (cookie) => cookie.name === "wos-session"
    );
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  } finally {
    try {
      await revokeVisibleKey(page, securityApiKey);
    } finally {
      await secondContext.close();
    }
  }
});
