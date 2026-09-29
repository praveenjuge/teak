import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, serve, spawn } from "bun";
import { EXIT } from "./runtime";

// Runs the real CLI entry point against a fake Teak API and checks what a
// user sees: stdout, stderr, exit code, and the requests the CLI sends.

const configHome = mkdtempSync(join(tmpdir(), "teak-cli-commands-"));
const API_KEY = "teak_test_key";

const card = (id: string, overrides: Record<string, unknown> = {}) => ({
  aiSummary: null,
  aiTags: [],
  aiTranscript: null,
  appUrl: `https://app.teakvault.com/?card=${id}`,
  colors: [],
  content: `Content of ${id}`,
  createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  id,
  isFavorited: false,
  notes: null,
  tags: [],
  type: "text",
  updatedAt: Date.UTC(2026, 0, 3, 3, 4, 5),
  url: null,
  ...overrides,
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Route = (request: Request, url: URL) => Response | Promise<Response>;
const routes = new Map<string, Route>();
const requests: { method: string; path: string; auth: string | null }[] = [];

const server = serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    requests.push({
      auth: request.headers.get("authorization"),
      method: request.method,
      path: `${url.pathname}${url.search}`,
    });
    const route = routes.get(`${request.method} ${url.pathname}`);
    return route
      ? route(request, url)
      : json({ code: "NOT_FOUND", error: "No such route" }, 404);
  },
});

afterAll(() => {
  server.stop();
  rmSync(configHome, { force: true, recursive: true });
});

beforeEach(() => {
  routes.clear();
  requests.length = 0;
});

const teak = async (...args: string[]) => {
  const child = spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...env,
      TEAK_API_KEY: API_KEY,
      TEAK_API_URL: server.url.toString(),
      XDG_CONFIG_HOME: configHome,
    },
    stderr: "pipe",
    stdout: "pipe",
    // Fail the test instead of hanging the suite if the CLI never exits.
    timeout: 15_000,
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stderr, stdout };
};

describe("teak cards", () => {
  test("lists cards one per line and reports the next cursor", async () => {
    routes.set("GET /v1/cards", () =>
      json({
        items: [card("card_a", { tags: ["design"] }), card("card_b")],
        pageInfo: { hasMore: true, nextCursor: "cursor_2" },
      })
    );

    const result = await teak("cards", "list");

    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith("card_a");
    expect(lines[0]).toContain("#design");
    expect(lines[1]).toStartWith("card_b");
    expect(result.stderr).toContain("nextCursor: cursor_2");
    expect(requests[0]?.auth).toBe(`Bearer ${API_KEY}`);
  });

  test("--all follows cursors until the last page", async () => {
    routes.set("GET /v1/cards", (_request, url) =>
      url.searchParams.get("cursor") === "cursor_2"
        ? json({
            items: [card("card_c")],
            pageInfo: { hasMore: false, nextCursor: null },
          })
        : json({
            items: [card("card_a"), card("card_b")],
            pageInfo: { hasMore: true, nextCursor: "cursor_2" },
          })
    );

    const result = await teak("--json", "cards", "list", "--all");

    expect(result.code).toBe(0);
    const page = JSON.parse(result.stdout);
    expect(page.items.map((item: { id: string }) => item.id)).toEqual([
      "card_a",
      "card_b",
      "card_c",
    ]);
    expect(page.pageInfo).toEqual({ hasMore: false, nextCursor: null });
    expect(requests).toHaveLength(2);
  });

  test("get prints the card detail", async () => {
    routes.set("GET /v1/cards/card_a", () =>
      json(
        card("card_a", {
          notes: "remember this",
          tags: ["design", "cli"],
          url: "https://example.com",
        })
      )
    );

    const result = await teak("cards", "get", "card_a");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("id: card_a");
    expect(result.stdout).toContain("created: 2026-01-02T03:04:05.000Z");
    expect(result.stdout).toContain("url: https://example.com");
    expect(result.stdout).toContain("notes: remember this");
    expect(result.stdout).toContain("tags: design, cli");
    expect(result.stdout).toContain("Content of card_a");
  });

  test("delete moves every id to trash and says so", async () => {
    routes.set(
      "DELETE /v1/cards/card_a",
      () => new Response(null, { status: 204 })
    );
    routes.set(
      "DELETE /v1/cards/card_b",
      () => new Response(null, { status: 204 })
    );

    const result = await teak("--json", "rm", "card_a", "card_b");

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      deletedIds: ["card_a", "card_b"],
    });
    expect(requests.map((request) => request.method)).toEqual([
      "DELETE",
      "DELETE",
    ]);
  });

  test("tags list prints names with counts", async () => {
    routes.set("GET /v1/tags", () =>
      json({
        items: [
          { count: 3, name: "design" },
          { count: 1, name: "cli" },
        ],
      })
    );

    const result = await teak("tags", "list");

    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(["design  3", "cli  1"]);
  });
});

describe("teak exit codes", () => {
  test("a missing card exits with the not-found code and a JSON error", async () => {
    routes.set("GET /v1/cards/missing", () =>
      json({ code: "NOT_FOUND", error: "Card not found" }, 404)
    );

    const result = await teak("--json", "cards", "get", "missing");

    expect(result.code).toBe(EXIT.notFound);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "NOT_FOUND", message: "Card not found" },
    });
  });

  test("a rejected API key exits with the auth code", async () => {
    routes.set("GET /v1/tags", () =>
      json({ code: "INVALID_API_KEY", error: "Invalid API key" }, 401)
    );

    const result = await teak("tags", "list");

    expect(result.code).toBe(EXIT.auth);
    expect(result.stderr).toContain("Invalid API key");
  });

  test("rate limiting exits with the rate-limited code", async () => {
    routes.set("GET /v1/cards", () =>
      json({ code: "RATE_LIMITED", error: "Slow down" }, 429)
    );

    const result = await teak("cards", "list");

    expect(result.code).toBe(EXIT.rateLimited);
    expect(result.stderr).toContain("Slow down");
  });

  test("an unknown bulk operation is a usage error and sends no request", async () => {
    const result = await teak("cards", "bulk", "explode");

    expect(result.code).toBe(EXIT.usage);
    expect(requests).toHaveLength(0);
  });
});
