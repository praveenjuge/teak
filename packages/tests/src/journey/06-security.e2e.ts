import { apiFetch } from "../helpers/api";
import {
  clientFor,
  createAccount,
  createApiAccount,
  generateApiKey,
  gotoApp,
  revokeVisibleKey,
} from "../helpers/app";
import { expect, test } from "../helpers/test";

test("cross-tenant, revoked-key, hostile input, headers, and cookie security", {
  timeout: 240_000,
}, async ({ browser, screen }) => {
  const surface = { browser, screen };
  const { apiKey: securityApiKey = "" } = await createAccount(
    surface,
    "security"
  );
  const second = await createApiAccount("tenant-b");
  try {
    const { cardId: targetCard } = await clientFor(securityApiKey).cards.create(
      { content: `security-tenant-a-${Date.now()}`, source: "e2e" }
    );
    expect(targetCard).toBeTruthy();
    expect(
      (await apiFetch(`/v1/cards/${targetCard}`, second.apiKey)).status
    ).toBe(404);
    const revokedKey = await generateApiKey(surface);
    await revokeVisibleKey(surface, revokedKey);
    expect((await apiFetch("/v1/tags", revokedKey)).status).toBe(401);
    const hostile = `<img src=x onerror="window.__teakXss=1"> javascript:alert(1) שלום ${"x".repeat(100_000)}`;
    await clientFor(securityApiKey).cards.create({
      content: hostile,
      source: "e2e",
      tags: ["xss"],
    });
    await gotoApp(browser, "/");
    await expect(
      screen
        .getByRole("main")
        .getByText(/javascript:alert\(1\)/)
        .first()
    ).toBeVisible();
    expect(await browser.evaluate(() => typeof (window as any).__teakXss)).toBe(
      "undefined"
    );
    // The local stack serves http, so the session cookie can't be Secure
    // here; authkit-nextjs sets Secure from an https redirect URI.
    const session = (await browser.cookies()).find(
      (cookie) => cookie.name === "wos-session"
    );
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    // Headers come from plain requests that share the page's cookies:
    // navigating away while the page is still refreshing its session would
    // race the rotated refresh token. A same-origin fetch from the page keeps
    // any rotated cookie in the browser.
    const responses = await browser.evaluate(
      async (paths) =>
        await Promise.all(
          paths.map(async (path) => {
            const response = await fetch(path, { credentials: "same-origin" });
            return {
              csp: response.headers.get("content-security-policy"),
              hsts: response.headers.get("strict-transport-security"),
              path,
            };
          })
        ),
      ["/login", "/settings"]
    );
    expect(responses).toHaveLength(2);
    for (const response of responses) {
      expect(response.hsts, response.path).toBeTruthy();
      const csp = response.csp ?? "";
      expect(csp, response.path).toBeTruthy();
      const imgSrc = csp
        .split(";")
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith("img-src"));
      expect(imgSrc, response.path).toBeTruthy();
      expect(imgSrc, response.path).toContain("r2.cloudflarestorage.com");
    }
  } finally {
    await revokeVisibleKey(surface, securityApiKey);
  }
});
