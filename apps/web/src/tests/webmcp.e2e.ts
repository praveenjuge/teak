/**
 * WebMCP provider coverage.
 *
 * Local verification runbook: the specs below run against a mock
 * `document.modelContext` injected below, so they pass in any Chromium. To
 * verify against the real draft API, use Chrome 149+ with
 * `about:flags#enable-webmcp-testing` enabled (origin trials are the
 * alternative on unflagged builds), sign in to the local dev server, and
 * confirm in DevTools that `document.modelContext.getTools()` lists the
 * imperative tools plus the declarative search form. Secure-context
 * requirements follow spec section 4; plain `http://localhost` qualifies.
 */
import { expect, type Page, test } from "@playwright/test";
import { AuthHelper, generateTestContent } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

declare global {
  interface Window {
    __webmcpRegistered?: { name: string; tool: unknown }[];
  }
}

const READ_TOOL_NAMES = [
  "teak_search_cards",
  "teak_get_card",
  "teak_recent_cards",
] as const;

const WRITE_TOOL_NAMES = [
  "teak_create_card",
  "teak_update_tags",
  "teak_set_favorite",
] as const;

const IMPERATIVE_TOOL_NAMES = [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES];

/** Wait until every executable imperative tool has registered. */
const waitForImperativeTools = (page: Page) =>
  page.waitForFunction(
    (names: readonly string[]) =>
      names.every((name) =>
        (window.__webmcpRegistered ?? []).some(
          (entry) =>
            entry.name === name &&
            typeof (entry.tool as { execute?: unknown })?.execute === "function"
        )
      ),
    [...IMPERATIVE_TOOL_NAMES],
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
      for (const name of IMPERATIVE_TOOL_NAMES) {
        expect(names).toContain(name);
      }
      expect(new Set(names).size).toBe(names.length);
    });

    test("marks write tools consequential", async ({ page }) => {
      await waitForImperativeTools(page);
      const annotations = await page.evaluate(
        (names: readonly string[]) =>
          (window.__webmcpRegistered ?? [])
            .filter((entry) => names.includes(entry.name))
            .map(
              (entry) =>
                (entry.tool as { annotations?: Record<string, unknown> })
                  .annotations ?? null
            ),
        [...WRITE_TOOL_NAMES]
      );
      expect(annotations).toEqual(
        WRITE_TOOL_NAMES.map(() => ({ consequentialHint: true }))
      );
    });

    test("marks read tools read-only with untrusted output", async ({
      page,
    }) => {
      await waitForImperativeTools(page);
      const annotations = await page.evaluate(
        (names: readonly string[]) =>
          (window.__webmcpRegistered ?? [])
            .filter((entry) => names.includes(entry.name))
            .map(
              (entry) =>
                (entry.tool as { annotations?: Record<string, unknown> })
                  .annotations ?? null
            ),
        [...READ_TOOL_NAMES]
      );
      expect(annotations).toEqual(
        READ_TOOL_NAMES.map(() => ({
          readOnlyHint: true,
          untrustedContentHint: true,
        }))
      );
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

    test("create tool creates a card and reads it back", async ({ page }) => {
      await waitForImperativeTools(page);
      const content = generateTestContent("WebMCP create");
      const created = (await executeTool(page, "teak_create_card", {
        content,
        type: "text",
      })) as { id: string; tags: string[]; type: string; url: string | null };
      expect(typeof created.id).toBe("string");
      expect(created.type).toBe("text");

      const fetched = (await executeTool(page, "teak_get_card", {
        cardId: created.id,
      })) as { content: string };
      expect(fetched.content).toContain(content);
    });

    test("tags tool adds and removes tags", async ({ page }) => {
      await waitForImperativeTools(page);
      const tag = `e2e-tag-${Date.now().toString(36)}`;
      const created = (await executeTool(page, "teak_create_card", {
        content: generateTestContent("WebMCP tags"),
      })) as { id: string };

      const added = (await executeTool(page, "teak_update_tags", {
        add: [tag],
        cardId: created.id,
      })) as { tags: string[] };
      expect(added.tags).toContain(tag);

      const removed = (await executeTool(page, "teak_update_tags", {
        cardId: created.id,
        remove: [tag],
      })) as { tags: string[] };
      expect(removed.tags).not.toContain(tag);
    });

    test("favorite tool sets and clears the flag", async ({ page }) => {
      await waitForImperativeTools(page);
      const created = (await executeTool(page, "teak_create_card", {
        content: generateTestContent("WebMCP favorite"),
      })) as { id: string };

      const favorited = (await executeTool(page, "teak_set_favorite", {
        cardId: created.id,
        favorited: true,
      })) as { isFavorited: boolean };
      expect(favorited.isFavorited).toBe(true);

      const fetched = (await executeTool(page, "teak_get_card", {
        cardId: created.id,
      })) as { isFavorited: boolean };
      expect(fetched.isFavorited).toBe(true);

      const unfavorited = (await executeTool(page, "teak_set_favorite", {
        cardId: created.id,
        favorited: false,
      })) as { isFavorited: boolean };
      expect(unfavorited.isFavorited).toBe(false);
    });

    test("recent tool lists newest cards first", async ({ page }) => {
      await waitForImperativeTools(page);
      const first = (await executeTool(page, "teak_create_card", {
        content: generateTestContent("WebMCP recent first"),
      })) as { id: string };
      const second = (await executeTool(page, "teak_create_card", {
        content: generateTestContent("WebMCP recent second"),
      })) as { id: string };

      const result = (await executeTool(page, "teak_recent_cards", {
        limit: 50,
      })) as { items: { createdAt: number; id: string }[]; total: number };
      const ids = result.items.map((item) => item.id);
      expect(ids).toContain(first.id);
      expect(ids).toContain(second.id);
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
      for (let index = 1; index < result.items.length; index += 1) {
        expect(result.items[index - 1].createdAt).toBeGreaterThanOrEqual(
          result.items[index].createdAt
        );
      }
      expect(result.total).toBe(result.items.length);

      const limited = (await executeTool(page, "teak_recent_cards", {
        limit: 1,
      })) as { items: unknown[] };
      expect(limited.items).toHaveLength(1);
    });

    test("write tools reject invalid input and unknown cards", async ({
      page,
    }) => {
      await waitForImperativeTools(page);
      await expect(
        executeTool(page, "teak_create_card", { content: "   " })
      ).rejects.toThrow(/"content"/);
      await expect(
        executeTool(page, "teak_update_tags", { cardId: "whatever" })
      ).rejects.toThrow(/add.*remove|empty/i);
      await expect(
        executeTool(page, "teak_set_favorite", {
          cardId: "000000000000000000000000",
          favorited: true,
        })
      ).rejects.toThrow(/not found/);
    });
  });
});
