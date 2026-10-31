import type { JsonValue } from "e2e";
import { appPath, gotoApp } from "../helpers/app";
import type { Browser } from "../helpers/test";
import { expect, generateTestContent, test } from "./fixtures";

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

const waitForImperativeTools = (browser: Browser) =>
  expect
    .poll(
      () =>
        browser.evaluate(
          (names: string[]) =>
            names.every((name) =>
              (window.__webmcpRegistered ?? []).some(
                (entry) =>
                  entry.name === name &&
                  typeof (entry.tool as { execute?: unknown } | undefined)
                    ?.execute === "function"
              )
            ),
          [...IMPERATIVE_TOOL_NAMES]
        ),
      { timeout: 30_000 }
    )
    .toBe(true);

type ToolOutcome =
  | { ok: true; result: JsonValue }
  | { error: string; ok: false };

/**
 * Runs a registered tool in the page and reports how its promise settled, so
 * a rejection keeps its own message rather than the evaluate wrapper's.
 */
const settleTool = (browser: Browser, name: string, input: JsonValue) =>
  browser.evaluate(
    async ([toolName, toolInput]: [
      string,
      JsonValue,
    ]): Promise<ToolOutcome> => {
      const entry = (window.__webmcpRegistered ?? []).find(
        (registered) => registered.name === toolName
      );
      const tool = entry?.tool as {
        execute: (
          input: unknown,
          options: { signal: AbortSignal }
        ) => Promise<JsonValue | undefined>;
      };
      try {
        const result = await tool.execute(toolInput, {
          signal: new AbortController().signal,
        });
        return { ok: true, result: result ?? null };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        };
      }
    },
    [name, input]
  );

const executeTool = async (
  browser: Browser,
  name: string,
  input: JsonValue
) => {
  const outcome = await settleTool(browser, name, input);
  if (!outcome.ok) {
    throw new Error(`${name} rejected: ${outcome.error}`);
  }
  return outcome.result as unknown;
};

const toolError = async (browser: Browser, name: string, input: JsonValue) => {
  const outcome = await settleTool(browser, name, input);
  expect(outcome.ok).toBe(false);
  return outcome.ok ? "" : outcome.error;
};

test.describe("WebMCP", () => {
  test("serves a Permissions-Policy that allows same-origin WebMCP tools", async ({
    browser,
    webAccount: _signedIn,
  }) => {
    const home = browser.waitForResponse(appPath("/"));
    await gotoApp(browser, "/sign-in");
    const response = await home;
    expect(response.status).toBe(200);
    expect(response.headers["permissions-policy"]).toContain("tools=(self)");
  });

  test.describe("authenticated tools", () => {
    test.beforeEach(async ({ browser, screen, webAccount: _signedIn }) => {
      await browser.addInitScript(() => {
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
      await browser.reload();
      await expect(
        screen.getByRole("textbox", "Markdown content", { exact: false })
      ).toBeVisible();
    });

    test("annotates the search box as a declarative WebMCP form", async ({
      browser,
    }) => {
      const form = browser.locator('form[toolname="teak_search_form"]');
      await expect(form).toBeVisible();
      await expect(form).toHaveAttribute(
        "tooldescription",
        /fill.*search box/i
      );
      expect(await form.getAttribute("toolautosubmit")).not.toBeNull();
      const query = browser.locator(
        'form[toolname="teak_search_form"] input[name="q"]'
      );
      await expect(query).toBeVisible();
      expect(await query.getAttribute("toolparamdescription")).not.toBeNull();
    });

    test("registers declarative and imperative tools without name collisions", async ({
      browser,
    }) => {
      await waitForImperativeTools(browser);
      const names = await browser.evaluate(() =>
        (window.__webmcpRegistered ?? []).map((entry) => entry.name)
      );
      expect(names).toContain("teak_search_form");
      for (const name of IMPERATIVE_TOOL_NAMES) {
        expect(names).toContain(name);
      }
      expect(new Set(names).size).toBe(names.length);
    });

    test("marks write tools consequential", async ({ browser }) => {
      await waitForImperativeTools(browser);
      const annotations = await browser.evaluate(
        (names: string[]) =>
          (window.__webmcpRegistered ?? [])
            .filter((entry) => names.includes(entry.name))
            .map(
              (entry) =>
                (entry.tool as { annotations?: Record<string, JsonValue> })
                  .annotations ?? null
            ),
        [...WRITE_TOOL_NAMES]
      );
      expect(annotations).toEqual(
        WRITE_TOOL_NAMES.map(() => ({ consequentialHint: true }))
      );
    });

    test("marks read tools read-only with untrusted output", async ({
      browser,
    }) => {
      await waitForImperativeTools(browser);
      const annotations = await browser.evaluate(
        (names: string[]) =>
          (window.__webmcpRegistered ?? [])
            .filter((entry) => names.includes(entry.name))
            .map(
              (entry) =>
                (entry.tool as { annotations?: Record<string, JsonValue> })
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
      browser,
    }) => {
      await waitForImperativeTools(browser);
      const result = await executeTool(browser, "teak_search_cards", {
        q: "qxjklwzmnv",
        limit: 5,
      });
      expect(result).toEqual({ items: [], total: 0 });
    });

    test("get tool returns null for an unknown card", async ({ browser }) => {
      await waitForImperativeTools(browser);
      const result = await executeTool(browser, "teak_get_card", {
        cardId: "000000000000000000000000",
      });
      expect(result).toBeNull();
    });

    test("create tool creates a card and reads it back", async ({
      browser,
    }) => {
      await waitForImperativeTools(browser);
      const content = generateTestContent("WebMCP create");
      const created = (await executeTool(browser, "teak_create_card", {
        content,
        type: "text",
      })) as { id: string; tags: string[]; type: string; url: string | null };
      expect(typeof created.id).toBe("string");
      expect(created.type).toBe("text");

      const fetched = (await executeTool(browser, "teak_get_card", {
        cardId: created.id,
      })) as { content: string };
      expect(fetched.content).toContain(content);
    });

    test("tags tool adds and removes tags", async ({ browser }) => {
      await waitForImperativeTools(browser);
      const tag = `e2e-tag-${Date.now().toString(36)}`;
      const created = (await executeTool(browser, "teak_create_card", {
        content: generateTestContent("WebMCP tags"),
      })) as { id: string };

      const added = (await executeTool(browser, "teak_update_tags", {
        add: [tag],
        cardId: created.id,
      })) as { tags: string[] };
      expect(added.tags).toContain(tag);

      const removed = (await executeTool(browser, "teak_update_tags", {
        cardId: created.id,
        remove: [tag],
      })) as { tags: string[] };
      expect(removed.tags).not.toContain(tag);
    });

    test("favorite tool sets and clears the flag", async ({ browser }) => {
      await waitForImperativeTools(browser);
      const created = (await executeTool(browser, "teak_create_card", {
        content: generateTestContent("WebMCP favorite"),
      })) as { id: string };

      const favorited = (await executeTool(browser, "teak_set_favorite", {
        cardId: created.id,
        favorited: true,
      })) as { isFavorited: boolean };
      expect(favorited.isFavorited).toBe(true);

      const fetched = (await executeTool(browser, "teak_get_card", {
        cardId: created.id,
      })) as { isFavorited: boolean };
      expect(fetched.isFavorited).toBe(true);

      const unfavorited = (await executeTool(browser, "teak_set_favorite", {
        cardId: created.id,
        favorited: false,
      })) as { isFavorited: boolean };
      expect(unfavorited.isFavorited).toBe(false);
    });

    test("recent tool lists newest cards first", async ({ browser }) => {
      await waitForImperativeTools(browser);
      const first = (await executeTool(browser, "teak_create_card", {
        content: generateTestContent("WebMCP recent first"),
      })) as { id: string };
      const second = (await executeTool(browser, "teak_create_card", {
        content: generateTestContent("WebMCP recent second"),
      })) as { id: string };

      const result = (await executeTool(browser, "teak_recent_cards", {
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

      const limited = (await executeTool(browser, "teak_recent_cards", {
        limit: 1,
      })) as { items: unknown[] };
      expect(limited.items).toHaveLength(1);
    });

    test("write tools reject invalid input and unknown cards", async ({
      browser,
    }) => {
      await waitForImperativeTools(browser);
      expect(
        await toolError(browser, "teak_create_card", { content: "   " })
      ).toMatch(/"content"/);
      expect(
        await toolError(browser, "teak_update_tags", { cardId: "whatever" })
      ).toMatch(/add.*remove|empty/i);
      expect(
        await toolError(browser, "teak_set_favorite", {
          cardId: "000000000000000000000000",
          favorited: true,
        })
      ).toMatch(/not found/);
    });
  });
});
