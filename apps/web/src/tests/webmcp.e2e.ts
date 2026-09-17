import { expect, test } from "@playwright/test";
import { AuthHelper } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

declare global {
  interface Window {
    __webmcpRegistered?: { name: string; tool: unknown }[];
  }
}

test.describe("WebMCP", () => {
  test("serves a Permissions-Policy that allows same-origin WebMCP tools", async ({
    page,
  }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["permissions-policy"]).toContain("tools=(self)");
  });

  test.describe("authenticated tools", () => {
    test.skip(
      !(TEST_EMAIL && TEST_PASSWORD),
      "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run WebMCP tests."
    );

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        window.__webmcpRegistered = [];
        const doc = document as Document & {
          modelContext?: {
            registerTool: (tool: { name: string }) => Promise<void>;
          };
        };
        doc.modelContext = {
          registerTool: (tool) => {
            window.__webmcpRegistered?.push({ name: tool.name, tool });
            return Promise.resolve();
          },
        };
      });
      const authHelper = new AuthHelper(page);
      await authHelper.signUpWithEmailAndPassword(
        TEST_EMAIL!,
        TEST_PASSWORD!,
        "E2E Test User"
      );
      await page.waitForLoadState("networkidle");
    });

    test("annotates the search box as a declarative WebMCP form", async ({
      page,
    }) => {
      const form = page.locator('form[toolname="teak_search_cards"]');
      await expect(form).toBeVisible();
      await expect(form).toHaveAttribute(
        "tooldescription",
        /search.*teak cards/i
      );
      await expect(form.locator('input[name="q"]')).toBeVisible();
    });

    test("registers the read-only imperative tools", async ({ page }) => {
      await page.waitForFunction(
        () => (window.__webmcpRegistered?.length ?? 0) > 0,
        { timeout: 30_000 }
      );
      const names = await page.evaluate(() =>
        Array.from(
          new Set((window.__webmcpRegistered ?? []).map((entry) => entry.name))
        )
      );
      expect(names).toContain("teak_search_cards");
      expect(names).toContain("teak_get_card");
    });

    test("search tool executes against the signed-in session", async ({
      page,
    }) => {
      await page.waitForFunction(
        () => (window.__webmcpRegistered?.length ?? 0) > 0,
        { timeout: 30_000 }
      );
      const result = await page.evaluate(() => {
        const entry = (window.__webmcpRegistered ?? []).find(
          ({ name }) => name === "teak_search_cards"
        );
        const tool = entry?.tool as {
          execute: (
            input: unknown,
            options: { signal: AbortSignal }
          ) => Promise<unknown>;
        };
        // Single nonsense token: the query tokenizer splits on punctuation,
        // so a dashed string could match the seeded welcome card's words.
        return tool.execute(
          { q: "qxjklwzmnv", limit: 5 },
          { signal: new AbortController().signal }
        );
      });
      expect(result).toEqual({ items: [], total: 0 });
    });

    test("get tool returns null for an unknown card", async ({ page }) => {
      await page.waitForFunction(
        () => (window.__webmcpRegistered?.length ?? 0) > 0,
        { timeout: 30_000 }
      );
      const result = await page.evaluate(() => {
        const entry = (window.__webmcpRegistered ?? []).find(
          ({ name }) => name === "teak_get_card"
        );
        const tool = entry?.tool as {
          execute: (
            input: unknown,
            options: { signal: AbortSignal }
          ) => Promise<unknown>;
        };
        return tool.execute(
          { cardId: "000000000000000000000000" },
          { signal: new AbortController().signal }
        );
      });
      expect(result).toBeNull();
    });
  });
});
