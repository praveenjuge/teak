import { expect, type Page, test } from "@playwright/test";
import { AuthHelper } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

declare global {
  interface Window {
    __webmcpRegistered?: { name: string; tool: unknown }[];
  }
}

/** Wait until both executable imperative tools have registered. */
const waitForImperativeTools = (page: Page) =>
  page.waitForFunction(
    () =>
      (window.__webmcpRegistered ?? []).filter(
        (entry) =>
          typeof (entry.tool as { execute?: unknown })?.execute === "function"
      ).length >= 2,
    { timeout: 30_000 }
  );

const executeTool = (page: Page, name: string, input: unknown) =>
  page.evaluate(
    ([toolName, toolInput]) => {
      const entry = (window.__webmcpRegistered ?? []).find(
        ({ name }) => name === toolName
      );
      const tool = entry?.tool as {
        execute: (
          input: unknown,
          options: { signal: AbortSignal }
        ) => Promise<unknown>;
      };
      return tool.execute(toolInput, {
        signal: new AbortController().signal,
      });
    },
    [name, input] as const
  );

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
        // Models two spec behaviors the page relies on: the browser derives
        // declarative tools from annotated forms, and registerTool rejects
        // duplicate names. Syncing on every call keeps a form rename that
        // collides with an imperative tool failing loudly.
        doc.modelContext = {
          registerTool: (tool) => {
            const registered = window.__webmcpRegistered ?? [];
            for (const form of document.querySelectorAll("form[toolname]")) {
              const name = form.getAttribute("toolname");
              if (name && !registered.some((entry) => entry.name === name)) {
                registered.push({ name, tool: { name, declarative: true } });
              }
            }
            if (registered.some((entry) => entry.name === tool.name)) {
              return Promise.reject(
                new Error(`duplicate tool name: ${tool.name}`)
              );
            }
            registered.push({ name: tool.name, tool });
            window.__webmcpRegistered = registered;
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
      const form = page.locator('form[toolname="teak_search_form"]');
      await expect(form).toBeVisible();
      await expect(form).toHaveAttribute(
        "tooldescription",
        /fill.*search box/i
      );
      expect(await form.getAttribute("toolautosubmit")).not.toBeNull();
      const query = form.locator('input[name="q"]');
      await expect(query).toBeVisible();
      expect(await query.getAttribute("toolparamdescription")).not.toBeNull();
    });

    test("registers declarative and imperative tools without name collisions", async ({
      page,
    }) => {
      await waitForImperativeTools(page);
      const names = await page.evaluate(() =>
        (window.__webmcpRegistered ?? []).map((entry) => entry.name)
      );
      expect(names).toContain("teak_search_form");
      expect(names).toContain("teak_search_cards");
      expect(names).toContain("teak_get_card");
      expect(new Set(names).size).toBe(names.length);
    });

    test("search tool executes against the signed-in session", async ({
      page,
    }) => {
      await waitForImperativeTools(page);
      // Single nonsense token: the query tokenizer splits on punctuation,
      // so a dashed string could match the seeded welcome card's words.
      const result = await executeTool(page, "teak_search_cards", {
        q: "qxjklwzmnv",
        limit: 5,
      });
      expect(result).toEqual({ items: [], total: 0 });
    });

    test("get tool returns null for an unknown card", async ({ page }) => {
      await waitForImperativeTools(page);
      const result = await executeTool(page, "teak_get_card", {
        cardId: "000000000000000000000000",
      });
      expect(result).toBeNull();
    });
  });
});
