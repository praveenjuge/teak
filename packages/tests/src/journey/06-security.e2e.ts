import { expect, test } from "@playwright/test";
import { apiFetch } from "../helpers/api";
import {
  clientFor,
  createAccount,
  deleteAccountViaUi,
  newAnonymousContext,
} from "../helpers/prod";
import { readState } from "../helpers/run-state";

test("cross-tenant, revoked-key, hostile input, headers, and cookie security", async ({
  browser,
  page,
  context,
}) => {
  const state = readState();
  if (!state.primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  const secondContext = await newAnonymousContext(browser);
  const secondPage = await secondContext.newPage();
  const second = await createAccount(secondPage, "tenant-b");
  try {
    const targetCard = state.createdCardIds[0];
    if (targetCard) {
      expect(
        (await apiFetch(`/v1/cards/${targetCard}`, second.apiKey!)).status
      ).toBe(404);
    }
    if (state.revokedKey) {
      expect((await apiFetch("/v1/tags", state.revokedKey)).status).toBe(401);
    }
    const hostile = `<img src=x onerror="window.__teakXss=1"> javascript:alert(1) שלום ${"x".repeat(100_000)}`;
    await clientFor(state.primary.apiKey).cards.create({
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
      expect(response?.headers()["content-security-policy"]).toBeTruthy();
    }
    const cookies = await context.cookies();
    expect(
      cookies.some(
        (cookie) => cookie.secure && cookie.httpOnly && cookie.sameSite
      )
    ).toBe(true);
  } finally {
    await deleteAccountViaUi(secondPage, second);
    await secondContext.close();
  }
});
