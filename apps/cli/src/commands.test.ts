import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, serve, spawn } from "bun";
import { EXIT } from "./runtime";

// Runs the real CLI entry point against a fake Teak API and checks what a
// user sees: stdout, stderr, exit code, and the requests the CLI sends.

const configHome = mkdtempSync(join(tmpdir(), "teak-cli-commands-"));
// Downloads land in the CLI's working directory, so give it a scratch one.
const workDirectory = mkdtempSync(join(tmpdir(), "teak-cli-work-"));
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
const requests: {
  auth: string | null;
  body: string;
  method: string;
  path: string;
}[] = [];

const server = serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    requests.push({
      auth: request.headers.get("authorization"),
      body: await request.clone().text(),
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
  rmSync(workDirectory, { force: true, recursive: true });
});

beforeEach(() => {
  routes.clear();
  requests.length = 0;
});

const teak = async (...args: string[]) => {
  const child = spawn(
    [process.execPath, "run", join(import.meta.dir, "index.ts"), ...args],
    {
      cwd: workDirectory,
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
    }
  );
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
      permanent: false,
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

const emptyPage = () =>
  json({ items: [], pageInfo: { hasMore: false, nextCursor: null } });
const noContent = () => new Response(null, { status: 204 });

describe("teak parity commands", () => {
  test("add lets Teak detect the card type unless --type is given", async () => {
    routes.set("POST /v1/cards", () =>
      json({ appUrl: "https://app/", cardId: "card_q", status: "created" })
    );
    await teak("add", '"Simplicity is the ultimate sophistication."');
    await teak("add", "#112233 #445566", "--type", "palette");
    expect(JSON.parse(requests[0]?.body ?? "{}")).not.toHaveProperty(
      "cardType"
    );
    expect(JSON.parse(requests[1]?.body ?? "{}").cardType).toBe("palette");
  });

  test("ls asks for content so each line shows a snippet", async () => {
    routes.set("GET /v1/cards", emptyPage);
    await teak("ls");
    expect(requests[0]?.path).toContain("include=content");
  });

  test("sends repeatable type, color, and plain-English date filters", async () => {
    routes.set("GET /v1/cards", emptyPage);
    const result = await teak(
      "ls",
      "--type",
      "image",
      "--type",
      "link",
      "--hue",
      "Blue",
      "--hex",
      "#112233",
      "--style",
      "minimal",
      "--date",
      "2026-03-01 to 2026-03-31"
    );
    expect(result.code).toBe(0);
    const url = new URL(`http://x${requests[0]?.path}`);
    expect(url.searchParams.getAll("type")).toEqual(["image", "link"]);
    expect(url.searchParams.getAll("hue")).toEqual(["blue"]);
    expect(url.searchParams.get("hex")).toBe("#112233");
    expect(url.searchParams.get("style")).toBe("minimal");
    expect(Number(url.searchParams.get("createdAfter"))).toBeLessThan(
      Number(url.searchParams.get("createdBefore"))
    );
  });

  test("rejects an unknown hue before sending a request", async () => {
    const result = await teak("ls", "--hue", "plaid");
    expect(result.code).toBe(EXIT.usage);
    expect(requests).toHaveLength(0);
  });

  test("search --all follows every page", async () => {
    routes.set("GET /v1/cards", (_request, url) =>
      url.searchParams.get("cursor")
        ? json({
            items: [card("card_b")],
            pageInfo: { hasMore: false, nextCursor: null },
          })
        : json({
            items: [card("card_a")],
            pageInfo: { hasMore: true, nextCursor: "c2" },
          })
    );
    const result = await teak("--json", "search", "design", "--all");
    expect(JSON.parse(result.stdout).items).toHaveLength(2);
  });

  test("trash lists Trash and restore brings cards back", async () => {
    routes.set("GET /v1/cards", emptyPage);
    routes.set("POST /v1/cards/card_a/restore", noContent);
    await teak("trash");
    const restored = await teak("restore", "card_a");
    expect(requests[0]?.path).toContain("trashed=true");
    expect(restored.code).toBe(0);
    expect(restored.stdout).toContain("Restored card_a");
  });

  test("permanent delete needs --yes when there is no terminal to ask", async () => {
    routes.set("DELETE /v1/cards/card_a", noContent);
    const refused = await teak("rm", "card_a", "--permanent");
    expect(refused.code).toBe(EXIT.usage);
    expect(requests).toHaveLength(0);
    const deleted = await teak("rm", "card_a", "--permanent", "--yes");
    expect(deleted.code).toBe(0);
    expect(requests[0]?.path).toBe("/v1/cards/card_a?permanent=true");
  });

  test("whoami shows the plan and how many cards are used", async () => {
    routes.set("GET /v1/me", () =>
      json({
        data: {
          id: "u",
          email: "me@example.org",
          plan: "free",
          cardCount: 29,
          cardLimit: 200,
          settingsUrl: "https://app/settings",
        },
      })
    );
    const result = await teak("whoami");
    expect(result.stdout).toBe("me@example.org\nFree plan · 29 of 200 cards\n");
  });

  test("tags rm removes own and AI tags in any capitalization", async () => {
    routes.set("GET /v1/cards/card_a", () =>
      json(
        card("card_a", { tags: ["keep", "drop"], aiTags: ["Design", "Web"] })
      )
    );
    routes.set("PATCH /v1/cards/card_a", () =>
      json(card("card_a", { tags: ["keep"], aiTags: ["Web"] }))
    );
    const result = await teak("tags", "rm", "card_a", "DROP", "design");
    expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({
      tags: ["keep"],
      removeAiTags: ["Design"],
    });
    expect(result.stdout).toContain("ai tags: Web");
  });

  test("download saves the original file and refuses to overwrite it", async () => {
    routes.set("GET /v1/cards/card_f", () =>
      json(
        card("card_f", {
          fileName: "poster.png",
          fileUrl: `${server.url}files/poster.png`,
        })
      )
    );
    routes.set("GET /files/poster.png", () => new Response("png-bytes"));
    const saved = await teak("download", "card_f");
    expect(saved.code).toBe(0);
    expect(readFileSync(join(workDirectory, "poster.png"), "utf8")).toBe(
      "png-bytes"
    );
    const again = await teak("download", "card_f");
    expect(again.code).toBe(EXIT.usage);
    expect(again.stderr).toContain("--force");
  });

  test("download refuses a file link that isn't a web address", async () => {
    routes.set("GET /v1/cards/card_f", () =>
      json(
        card("card_f", { fileName: "secrets", fileUrl: "file:///etc/hosts" })
      )
    );
    const result = await teak("download", "card_f");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("isn't a web address");
    expect(existsSync(join(workDirectory, "secrets"))).toBe(false);
  });

  test("download explains when a card has no file", async () => {
    routes.set("GET /v1/cards/card_a", () => json(card("card_a")));
    const result = await teak("download", "card_a");
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain("no file");
    expect(existsSync(join(workDirectory, "card_a.bin"))).toBe(false);
  });

  test("export waits for the ZIP and saves it", async () => {
    let polls = 0;
    const job = (status: string) => ({
      id: "exp_1",
      status,
      cardCount: status === "ready" ? 3 : null,
      createdAt: Date.UTC(2026, 9, 10),
      downloadUrl: status === "ready" ? `${server.url}files/export.zip` : null,
    });
    routes.set("POST /v1/exports", () => json({ job: job("pending") }, 202));
    routes.set("GET /v1/exports/latest", () => {
      polls += 1;
      return json({
        job: job(polls > 1 ? "ready" : "running"),
        canStartNew: false,
        nextAvailableAt: null,
      });
    });
    routes.set("GET /files/export.zip", () => new Response("zip-bytes"));
    const result = await teak("export", "-o", "backup.zip");
    expect(result.code).toBe(0);
    expect(readFileSync(join(workDirectory, "backup.zip"), "utf8")).toBe(
      "zip-bytes"
    );
  });

  test("a second export in a week says when the next one is possible", async () => {
    routes.set("POST /v1/exports", () =>
      json({ code: "RATE_LIMITED", error: "weekly", retryAt: 1 }, 429)
    );
    routes.set("GET /v1/exports/latest", () =>
      json({
        job: {
          id: "exp_1",
          status: "ready",
          cardCount: 3,
          createdAt: 1,
          downloadUrl: null,
        },
        canStartNew: false,
        nextAvailableAt: Date.UTC(2026, 9, 17),
      })
    );
    const result = await teak("export");
    expect(result.code).toBe(EXIT.rateLimited);
    expect(result.stderr).toContain("one export every 7 days");
    expect(result.stderr).toContain("Next export available");
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
