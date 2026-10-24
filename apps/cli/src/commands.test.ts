import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, serve, spawn } from "bun";
import { EXIT } from "./runtime";

const configHome = mkdtempSync(join(tmpdir(), "teak-cli-commands-"));
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

const teakWithEnv = async (
  extraEnv: Record<string, string>,
  ...args: string[]
) => {
  const child = spawn(
    [process.execPath, "run", join(import.meta.dir, "index.ts"), ...args],
    {
      cwd: workDirectory,
      env: {
        ...env,
        TEAK_API_KEY: API_KEY,
        TEAK_API_URL: server.url.toString(),
        XDG_CONFIG_HOME: configHome,
        ...extraEnv,
      },
      stderr: "pipe",
      stdout: "pipe",
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
const teak = (...args: string[]) => teakWithEnv({}, ...args);

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

  test("changes lists changed cards, deleted card IDs and the next cursor", async () => {
    routes.set("GET /v1/cards/changes", () =>
      json({
        deletedIds: ["card_gone", "card_trashed"],
        items: [card("card_a")],
        pageInfo: { hasMore: true, nextCursor: "cursor_2" },
      })
    );

    const result = await teak("cards", "changes", "--since", "1767225600000");

    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toStartWith("card_a");
    expect(lines.slice(1)).toEqual([
      "deleted card_gone",
      "deleted card_trashed",
    ]);
    expect(result.stderr).toContain("nextCursor: cursor_2");
    expect(requests[0]?.path).toContain("since=1767225600000");
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
    expect(result.stdout).not.toContain("price:");
  });

  test("get prints a product's price in its currency, or the bare amount", async () => {
    routes.set("GET /v1/cards/card_a", () =>
      json(
        card("card_a", {
          type: "link",
          url: "https://www.amazon.de/dp/1",
          linkPrice: { amount: 1299, currency: "EUR" },
        })
      )
    );
    routes.set("GET /v1/cards/card_b", () =>
      json(
        card("card_b", {
          type: "link",
          url: "https://shop.example/thing",
          linkPrice: { amount: 24.5, currency: null },
        })
      )
    );

    const euro = await teak("cards", "get", "card_a");
    const bare = await teak("cards", "get", "card_b");

    expect(euro.code).toBe(0);
    expect(euro.stdout).toContain("price: €1,299.00");
    expect(bare.stdout).toContain("price: 24.5");
  });

  test("get prints a file card's name and readable size", async () => {
    routes.set("GET /v1/cards/card_a", () =>
      json(
        card("card_a", {
          fileName: "notes.pdf",
          fileSize: 4_812_000,
          type: "document",
        })
      )
    );

    const result = await teak("cards", "get", "card_a");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("file: notes.pdf (4.6 MB)");
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

  test.each([
    ["--limit", "10abc"],
    ["--limit", "2.5"],
    ["--limit", "1e3"],
  ])("rejects %s %s before sending a request", async (flag, value) => {
    const result = await teak("ls", flag, value);
    expect(result.code).toBe(EXIT.usage);
    expect(requests).toHaveLength(0);
  });

  test("rejects a date passed as --since", async () => {
    const result = await teak("cards", "changes", "--since", "2026-01-01");
    expect(result.code).toBe(EXIT.usage);
    expect(requests).toHaveLength(0);
  });

  test("search sends operators in q, and an unquoted exclusion says how to pass it", async () => {
    routes.set("GET /v1/cards", () =>
      json({ items: [], pageInfo: { hasMore: false, nextCursor: null } })
    );
    expect((await teak("search", "design -tag:old OR x")).code).toBe(0);
    expect((await teak("search", "--", "-tag:old")).code).toBe(0);
    expect(
      requests.map((request) =>
        new URLSearchParams(request.path.split("?")[1]).get("q")
      )
    ).toEqual(["design -tag:old OR x", "-tag:old"]);

    const unquoted = await teak("search", "-tag:old");
    expect(unquoted.code).toBe(EXIT.usage);
    expect(unquoted.stderr).toContain("unknown option '-tag:old'");
    expect(unquoted.stderr).toContain('teak search "design -tag:old"');
    expect(unquoted.stderr).toContain("teak search -- -tag:old");
    const other = await teak("ls", "-bogus");
    expect(other.code).toBe(EXIT.usage);
    expect(other.stderr).toContain("unknown option '-bogus'");
    expect(other.stderr).not.toContain("leave something out");
    expect((await teak("cards", "search", "-tag:old")).stderr).toContain(
      "teak search -- -tag:old"
    );
    expect(requests).toHaveLength(2);
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

  test("done marks a link done, --undo clears it, and a note is refused", async () => {
    const link = card("card_a", { type: "link", url: "https://example.com" });
    routes.set("POST /v1/cards/card_a/done", () =>
      json({ ...link, completedAt: Date.UTC(2026, 9, 17) })
    );
    routes.set("DELETE /v1/cards/card_a/done", () => json(link));
    routes.set("POST /v1/cards/note/done", () =>
      json(
        { code: "TYPE_MISMATCH", error: "Only link cards can be marked done" },
        400
      )
    );
    routes.set("GET /v1/cards/card_a", () =>
      json({ ...link, completedAt: Date.UTC(2026, 9, 17) })
    );

    const done = await teak("done", "card_a");
    const undone = await teak("cards", "done", "card_a", "--undo");
    const refused = await teak("done", "note");
    const detail = await teak("cards", "get", "card_a");

    expect(
      requests.map((request) => `${request.method} ${request.path}`)
    ).toEqual([
      "POST /v1/cards/card_a/done",
      "DELETE /v1/cards/card_a/done",
      "POST /v1/cards/note/done",
      "GET /v1/cards/card_a",
    ]);
    expect(done.code).toBe(0);
    expect(done.stdout).toContain("card_a");
    expect(undone.code).toBe(0);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("Only link cards can be marked done");
    expect(detail.stdout).toContain("done: 2026-10-17T00:00:00.000Z");
  });

  test("cards save-pdf saves a paper once and says when it already has", async () => {
    let created = true;
    routes.set("POST /v1/cards/paper/save-pdf", () => {
      const body = { cardId: "doc_1", created };
      created = false;
      return json(body, body.created ? 201 : 200);
    });
    routes.set("POST /v1/cards/note/save-pdf", () =>
      json(
        { code: "INVALID_INPUT", error: "This card has no PDF to save." },
        400
      )
    );

    const first = await teak("cards", "save-pdf", "paper");
    const again = await teak("cards", "save-pdf", "paper");
    const againJson = await teak("cards", "save-pdf", "paper", "--json");
    const refused = await teak("cards", "save-pdf", "note");

    expect(first.code).toBe(0);
    expect(first.stdout).toContain("Saved the PDF as doc_1");
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("Already saved as doc_1");
    expect(JSON.parse(againJson.stdout)).toEqual({
      cardId: "doc_1",
      created: false,
    });
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("This card has no PDF to save.");
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

  test("permanent delete of a card outside Trash moves it there first", async () => {
    const inTrash = new Set<string>();
    routes.set("DELETE /v1/cards/card_a", (_request, url) => {
      if (url.searchParams.get("permanent") !== "true") {
        inTrash.add("card_a");
        return noContent();
      }
      return inTrash.has("card_a")
        ? noContent()
        : json(
            { code: "NOT_IN_TRASH", error: "Move the card to Trash first" },
            409
          );
    });
    const deleted = await teak("rm", "card_a", "--permanent", "--yes");
    expect(deleted.code).toBe(0);
    expect(deleted.stdout).toContain("Deleted card_a forever");
    expect(requests.map((request) => request.path)).toEqual([
      "/v1/cards/card_a?permanent=true",
      "/v1/cards/card_a",
      "/v1/cards/card_a?permanent=true",
    ]);
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

  test.each([
    ["de", "Deutsch"],
    ["pt-BR", "Português (Brasil)"],
    ["ja", "日本語"],
    ["tlh", "tlh"],
  ])("whoami names the %s language in its own name", async (locale, name) => {
    routes.set("GET /v1/me", () =>
      json({
        data: {
          id: "u",
          email: "me@example.org",
          plan: "pro",
          cardCount: 3,
          cardLimit: null,
          locale,
          settingsUrl: "https://app/settings",
        },
      })
    );
    const result = await teak("whoami");
    expect(result.stdout).toBe(
      `me@example.org\nPro plan · 3 cards\nLanguage: ${name}\n`
    );
  });

  test("whoami --json passes the locale through", async () => {
    routes.set("GET /v1/me", () =>
      json({
        data: {
          id: "u",
          email: "me@example.org",
          plan: "free",
          cardCount: 0,
          cardLimit: 200,
          locale: "ko",
          settingsUrl: "https://app/settings",
        },
      })
    );
    const result = await teak("--json", "whoami");
    expect(JSON.parse(result.stdout)).toMatchObject({ locale: "ko" });
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

  test("tags rename --wait polls until every card has changed", async () => {
    const operation = (status: string, changed: number) => ({
      id: "op_1",
      kind: "rename",
      from: "design",
      to: "Design Systems",
      status,
      total: 3,
      processed: changed,
      changed,
      error: null,
      createdAt: 1,
      updatedAt: Date.now(),
      completedAt: status === "completed" ? 2 : null,
    });
    let polls = 0;
    routes.set("POST /v1/tags/rename", () =>
      json({ operationId: "op_1", ...operation("running", 0) }, 202)
    );
    routes.set("GET /v1/tags/operations/op_1", () => {
      polls += 1;
      return json(operation(polls > 1 ? "completed" : "running", polls));
    });
    const result = await teak(
      "tags",
      "rename",
      "Design",
      "Design Systems",
      "--wait"
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(
      'Renamed "design" to "Design Systems" on 2 cards.'
    );
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      from: "Design",
      to: "Design Systems",
    });

    const started = await teak("tags", "rename", "Design", "Design Systems");
    expect(started.stdout).toContain("Check with: teak tags status op_1");
  });

  test("tags status --wait stops on a change that stopped making progress", async () => {
    const stalled = {
      id: "op_3",
      kind: "delete",
      from: "old",
      to: null,
      status: "running",
      total: 10,
      processed: 4,
      changed: 4,
      error: null,
      createdAt: 1,
      updatedAt: Date.now() - 10 * 60_000,
      completedAt: null,
    };
    routes.set("GET /v1/tags/operations/op_3", () => json(stalled));
    const result = await teak("tags", "status", "op_3", "--wait");
    expect(result.code).toBe(EXIT.api);
    expect(result.stdout.trim()).toBe(
      'Couldn\'t finish deleting "old". 4 of 10 cards changed.'
    );
  });

  test("tags merge and status report a failed change with the API exit code", async () => {
    routes.set("POST /v1/tags/merge", () =>
      json(
        {
          operationId: "op_2",
          id: "op_2",
          kind: "merge",
          from: "ux",
          to: "research",
          status: "failed",
          total: 300,
          processed: 120,
          changed: 120,
          error: "Stopped before it finished",
          createdAt: 1,
          updatedAt: 1,
          completedAt: 2,
        },
        202
      )
    );
    const result = await teak("tags", "merge", "ux", "research");
    expect(result.code).toBe(EXIT.api);
    expect(result.stdout.trim()).toBe(
      'Couldn\'t finish merging "ux". 120 of 300 cards changed.'
    );
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      from: "ux",
      into: "research",
    });
  });

  test("tags delete needs --yes without a terminal, and a running change is refused", async () => {
    const unconfirmed = await teak("tags", "delete", "old");
    expect(unconfirmed.code).toBe(EXIT.usage);
    expect(unconfirmed.stderr).toContain("add --yes to confirm");
    expect(requests).toHaveLength(0);

    routes.set("POST /v1/tags/delete", () =>
      json(
        {
          code: "TAG_OPERATION_RUNNING",
          error: "Another tag change is still running",
        },
        409
      )
    );
    const refused = await teak("tags", "delete", "old", "--yes");
    expect(refused.code).toBe(EXIT.api);
    expect(refused.stderr).toContain("Another tag change is still running");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ tag: "old" });
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

  test("an export that fails while waiting exits with the API error code", async () => {
    routes.set("POST /v1/exports", () =>
      json({ job: { id: "exp_2", status: "pending" } }, 202)
    );
    routes.set("GET /v1/exports/latest", () =>
      json({
        job: {
          cardCount: null,
          createdAt: Date.UTC(2026, 9, 10),
          downloadUrl: null,
          id: "exp_2",
          status: "failed",
        },
        canStartNew: true,
        nextAvailableAt: null,
      })
    );
    const result = await teak("export", "-o", "failed.zip");
    expect(result.code).toBe(EXIT.api);
    expect(existsSync(join(workDirectory, "failed.zip"))).toBe(false);
  });

  test("a ready export with no download exits with the API error code for -o", async () => {
    routes.set("POST /v1/exports", () =>
      json({ job: { id: "exp_3", status: "pending" } }, 202)
    );
    routes.set("GET /v1/exports/latest", () =>
      json({
        job: {
          cardCount: 3,
          createdAt: Date.UTC(2026, 9, 10),
          downloadUrl: null,
          id: "exp_3",
          status: "ready",
        },
        canStartNew: false,
        nextAvailableAt: null,
      })
    );
    const result = await teak("export", "-o", "missing.zip");
    expect(result.code).toBe(EXIT.api);
    expect(existsSync(join(workDirectory, "missing.zip"))).toBe(false);
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

describe("teak batch and fallback behavior", () => {
  test("add keeps the text as content when --url is also given", async () => {
    routes.set("POST /v1/cards", () =>
      json({ appUrl: "https://app/", cardId: "card_l", status: "created" })
    );
    const result = await teak(
      "add",
      "Read this later",
      "--url",
      "https://example.com/article"
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      content: "Read this later",
      url: "https://example.com/article",
    });
  });

  test("add --source-url keeps a quote as text and sends its page", async () => {
    routes.set("POST /v1/cards", () =>
      json({ appUrl: "https://app/", cardId: "card_q", status: "created" })
    );
    const result = await teak(
      "add",
      "A line worth keeping",
      "--source-url",
      "https://example.com/essay",
      "--source-title",
      "An essay"
    );
    expect(result.code).toBe(0);
    const body = JSON.parse(requests[0]?.body ?? "{}");
    expect(body).toMatchObject({
      content: "A line worth keeping",
      sourceTitle: "An essay",
      sourceUrl: "https://example.com/essay",
    });
    expect(body).not.toHaveProperty("url");
  });

  test("add says when the link was already in Teak and moved to the top", async () => {
    routes.set("POST /v1/cards", () =>
      json({
        appUrl: "https://app/?card=card_l",
        cardId: "card_l",
        resaved: true,
        status: "created",
      })
    );
    const result = await teak("add", "https://example.com/article");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(
      "Already in Teak, moved to the top: card_l  https://app/?card=card_l"
    );

    routes.set("POST /v1/cards", () =>
      json({ appUrl: "https://app/", cardId: "card_n", status: "created" })
    );
    const created = await teak("add", "https://example.com/new");
    expect(created.stdout.trim()).toBe("card_n  https://app/");
  });

  test("get shows when a card was saved again, more than a minute after it was made", async () => {
    const createdAt = Date.UTC(2026, 0, 2, 3, 4, 5);
    routes.set("GET /v1/cards/card_a", () =>
      json(card("card_a", { savedAt: Date.UTC(2026, 4, 6, 7, 8, 9) }))
    );
    routes.set("GET /v1/cards/card_b", () =>
      json(card("card_b", { savedAt: createdAt + 30_000 }))
    );
    const again = await teak("cards", "get", "card_a");
    expect(again.stdout).toContain("created: 2026-01-02T03:04:05.000Z");
    expect(again.stdout).toContain("Saved again 2026-05-06T07:08:09.000Z");
    const once = await teak("cards", "get", "card_b");
    expect(once.stdout).not.toContain("Saved again");
  });

  test("add with only a URL argument sends no duplicate content", async () => {
    routes.set("POST /v1/cards", () =>
      json({ appUrl: "https://app/", cardId: "card_l", status: "created" })
    );
    await teak("add", "https://example.com/article");
    const body = JSON.parse(requests[0]?.body ?? "{}");
    expect(body.url).toBe("https://example.com/article");
    expect(body).not.toHaveProperty("content");
  });

  const missing = () =>
    json({ code: "NOT_FOUND", error: "Card not found" }, 404);

  test("rm tries every id and reports which ones failed", async () => {
    routes.set("DELETE /v1/cards/card_a", noContent);
    routes.set("DELETE /v1/cards/bogus", missing);
    routes.set("DELETE /v1/cards/card_b", noContent);

    const result = await teak("rm", "card_a", "bogus", "card_b");

    expect(result.code).toBe(EXIT.notFound);
    expect(requests.map((request) => request.path)).toEqual([
      "/v1/cards/card_a",
      "/v1/cards/bogus",
      "/v1/cards/card_b",
    ]);
    expect(result.stdout).toContain("Moved card_a to Trash");
    expect(result.stdout).toContain("Moved card_b to Trash");
    expect(result.stdout).not.toContain("Moved bogus");
    expect(result.stderr).toContain("bogus: Card not found");
  });

  test("rm --json lists deleted and failed ids", async () => {
    routes.set("DELETE /v1/cards/card_a", noContent);
    routes.set("DELETE /v1/cards/bogus", missing);

    const result = await teak("--json", "rm", "card_a", "bogus");

    expect(result.code).toBe(EXIT.notFound);
    expect(JSON.parse(result.stdout)).toEqual({
      deletedIds: ["card_a"],
      failed: [{ code: "NOT_FOUND", id: "bogus", message: "Card not found" }],
      permanent: false,
    });
  });

  test("restore tries every id and reports which ones failed", async () => {
    routes.set("POST /v1/cards/bogus/restore", missing);
    routes.set("POST /v1/cards/card_b/restore", noContent);

    const text = await teak("restore", "bogus", "card_b");
    expect(text.code).toBe(EXIT.notFound);
    expect(text.stdout).toContain("Restored card_b");
    expect(text.stderr).toContain("bogus: Card not found");

    const result = await teak("--json", "restore", "bogus", "card_b");
    expect(JSON.parse(result.stdout)).toEqual({
      failed: [{ code: "NOT_FOUND", id: "bogus", message: "Card not found" }],
      restoredIds: ["card_b"],
    });
  });

  test("cards thumbnail uploads an image and applies it", async () => {
    const image = join(workDirectory, "cover.png");
    writeFileSync(image, new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    routes.set("POST /v1/cards/card_a/thumbnail/upload", () =>
      json({
        expiresIn: 600,
        fileKey: "pending/cover",
        maxFileSize: 20 * 1024 * 1024,
        method: "PUT",
        uploadUrl: new URL("/__upload/v1/pending", server.url).toString(),
      })
    );
    routes.set("PUT /__upload/v1/pending", () => new Response(null));
    routes.set("PUT /v1/cards/card_a/thumbnail", () =>
      json(card("card_a", { thumbnailOverridden: true, type: "link" }))
    );

    const result = await teak("cards", "thumbnail", "card_a", image);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("Replaced the image of card_a");
    expect(
      requests.map((request) => `${request.method} ${request.path}`)
    ).toEqual([
      "POST /v1/cards/card_a/thumbnail/upload",
      "PUT /__upload/v1/pending",
      "PUT /v1/cards/card_a/thumbnail",
    ]);
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({
      fileSize: 7,
      mimeType: "image/png",
    });
    expect(JSON.parse(requests[2]?.body ?? "")).toEqual({
      fileKey: "pending/cover",
    });
  });

  test("cards thumbnail --reset goes back to the link's own image", async () => {
    routes.set("DELETE /v1/cards/card_a/thumbnail", () =>
      json(card("card_a", { thumbnailOverridden: false, type: "link" }))
    );
    const result = await teak("cards", "thumbnail", "card_a", "--reset");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("card_a shows its original image");
    expect(requests.map((request) => request.method)).toEqual(["DELETE"]);
  });

  test("cards thumbnail refuses an SVG before uploading", async () => {
    const image = join(workDirectory, "logo.svg");
    writeFileSync(image, "<svg/>");
    const result = await teak("cards", "thumbnail", "card_a", image);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain(
      "Use a JPEG, PNG, WebP, GIF or AVIF image."
    );
    expect(requests).toHaveLength(0);
  });

  test("refresh queues each card and reports rate limits", async () => {
    routes.set("POST /v1/cards/card_a/refresh", () =>
      json({ cardId: "card_a", requestedAt: 1, status: "queued" }, 202)
    );
    routes.set("POST /v1/cards/card_b/refresh", () =>
      json(
        {
          code: "RATE_LIMITED",
          error: "This card is already refreshing. Try again in a minute.",
          retryAt: Date.now() + 30_000,
        },
        429
      )
    );

    const text = await teak("refresh", "card_a", "card_b");
    expect(text.code).toBe(EXIT.rateLimited);
    expect(text.stdout).toContain("Refreshing card_a");
    expect(text.stderr).toContain("card_b: This card is already refreshing");

    const result = await teak("--json", "cards", "refresh", "card_a");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ queuedIds: ["card_a"] });
  });

  test("cards duplicate prints the matching card's id, or exits not found", async () => {
    routes.set("GET /v1/cards/duplicate", (_request, url) =>
      json({
        cardId:
          url.searchParams.get("url") === "https://example.com/a"
            ? "card_a"
            : null,
      })
    );
    const found = await teak("cards", "duplicate", "https://example.com/a");
    expect(found.code).toBe(0);
    expect(found.stdout).toBe("card_a\n");
    const asJson = await teak(
      "--json",
      "cards",
      "duplicate",
      "https://example.com/a"
    );
    expect(JSON.parse(asJson.stdout)).toEqual({ cardId: "card_a" });
    const none = await teak("cards", "duplicate", "https://example.com/b");
    expect(none.code).toBe(EXIT.notFound);
    expect(none.stderr).toContain("No card saves this URL");
  });

  test("content prints a card's text, notes truncation on stderr, and --json the envelope", async () => {
    const body = {
      cardId: "card_a",
      kind: "document",
      text: "Kestrel Freight agreed to net 30 days.",
      charCount: 38,
      truncated: true,
    };
    routes.set("GET /v1/cards/card_a/content", () => json(body));
    routes.set("GET /v1/cards/card_b/content", () =>
      json({ code: "NO_CONTENT", error: "This card has no stored text" }, 404)
    );

    const text = await teak("content", "card_a");
    expect(text.code).toBe(0);
    expect(text.stdout).toBe("Kestrel Freight agreed to net 30 days.\n");
    expect(text.stderr).toContain("first 500 pages");

    const result = await teak("--json", "cards", "content", "card_a");
    expect(JSON.parse(result.stdout)).toEqual(body);
    expect(result.stderr).toBe("");

    const missing = await teak("content", "card_b");
    expect(missing.code).toBe(EXIT.notFound);
    expect(missing.stderr).toContain("This card has no stored text");

    routes.set("GET /v1/cards/card_c/content", () =>
      json({ ...body, cardId: "card_c", charCount: 90_000 })
    );
    const partial = await teak("content", "card_c");
    expect(partial.code).toBe(0);
    expect(partial.stderr).toContain("try again later");
  });

  test("links lists links then backlinks, says when there are none, and --json the lists", async () => {
    routes.set("GET /v1/cards/card_a", () =>
      json(
        card("card_a", {
          backlinks: [
            {
              id: "card_c",
              missing: false,
              title: "Weekly review",
              type: "text",
            },
          ],
          backlinksTruncated: false,
          links: [
            {
              id: "card_b",
              missing: false,
              title: "Garden plan",
              type: "text",
            },
            { id: "gone", missing: true, title: null, type: null },
          ],
          linksTruncated: false,
        })
      )
    );
    routes.set("GET /v1/cards/card_d", () => json(card("card_d")));
    routes.set("GET /v1/cards/card_x", () =>
      json({ code: "NOT_FOUND", error: "Card not found" }, 404)
    );

    const text = await teak("links", "card_a");
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(
      [
        "Links",
        "card_b  text      Garden plan",
        "gone  (missing)",
        "",
        "Linked from",
        "card_c  text      Weekly review",
        "",
      ].join("\n")
    );

    const asJson = await teak("--json", "cards", "links", "card_a");
    expect(JSON.parse(asJson.stdout)).toMatchObject({
      backlinksTruncated: false,
      links: [{ id: "card_b" }, { id: "gone", missing: true }],
      linksTruncated: false,
    });

    expect((await teak("links", "card_d")).stdout).toBe("No links.\n");

    routes.set("GET /v1/cards/card_e", () =>
      json(
        card("card_e", {
          backlinks: [
            { id: "card_c", missing: false, title: "Review", type: "text" },
          ],
          backlinksTruncated: true,
          links: [
            { id: "card_b", missing: false, title: "Plan", type: "text" },
          ],
          linksTruncated: true,
        })
      )
    );
    expect((await teak("links", "card_e")).stdout).toBe(
      [
        "Links",
        "card_b  text      Plan",
        "and more (first 100 shown)",
        "",
        "Linked from",
        "card_c  text      Review",
        "and more (first 100 shown)",
        "",
      ].join("\n")
    );

    const missing = await teak("links", "card_x");
    expect(missing.code).toBe(EXIT.notFound);
    expect(missing.stderr).toContain("Card not found");
  });

  test("archive and unarchive change each card, and ls --archived lists them", async () => {
    routes.set("PATCH /v1/cards/card_a", () =>
      json(card("card_a", { isArchived: true }))
    );
    routes.set("PATCH /v1/cards/card_b", () =>
      json({ code: "NOT_FOUND", error: "Card not found" }, 404)
    );

    const archived = await teak("archive", "card_a", "card_b");
    expect(archived.stdout).toContain("Archived card_a");
    expect(archived.stderr).toContain("card_b: Card not found");
    expect(archived.code).not.toBe(0);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ isArchived: true });

    requests.length = 0;
    const restored = await teak("--json", "cards", "unarchive", "card_a");
    expect(restored.code).toBe(0);
    expect(JSON.parse(restored.stdout)).toEqual({ unarchivedIds: ["card_a"] });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      isArchived: false,
    });

    routes.set("GET /v1/cards", emptyPage);
    requests.length = 0;
    await teak("ls", "--archived");
    expect(requests[0]?.path).toContain("archived=only");
  });

  test("folders: list, create, rename, add and remove cards, and ls --folder", async () => {
    const reading = {
      id: "folder_1",
      name: "Reading",
      color: "blue",
      kind: "manual",
      cardCount: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    routes.set("GET /v1/folders", () => json({ items: [reading] }));
    routes.set("POST /v1/folders", () =>
      json({ ...reading, id: "folder_2", name: "Later", color: null }, 201)
    );
    routes.set("PATCH /v1/folders/folder_1", () =>
      json({ ...reading, name: "Read later", color: null })
    );
    routes.set("POST /v1/folders/folder_1/cards", () =>
      json({
        updatedIds: ["card_a"],
        failedIds: ["card_b"],
        folderLimitIds: ["card_b"],
      })
    );
    routes.set(
      "DELETE /v1/folders/folder_1",
      () => new Response(null, { status: 204 })
    );

    const listed = await teak("folders");
    expect(listed.stdout).toContain("folder_1");
    expect(listed.stdout).toContain("Reading (blue)");

    routes.set("GET /v1/folders/folder_1", () =>
      json({ ...reading, cardCount: 3 })
    );
    const shown = await teak("folders", "get", "reading");
    expect(shown.code).toBe(0);
    expect(shown.stdout).toMatch(/^folder_1\s+3\s+Reading \(blue\)/);
    const missingFolder = await teak("folders", "show", "nope");
    expect(missingFolder.code).toBe(EXIT.notFound);

    const created = await teak(
      "folders",
      "create",
      "Later",
      "--color",
      "green"
    );
    expect(created.code).toBe(0);
    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({
      name: "Later",
      color: "green",
    });

    requests.length = 0;
    const renamed = await teak(
      "folders",
      "rename",
      "reading",
      "Read later",
      "--color",
      "none"
    );
    expect(renamed.stdout).toContain("Read later");
    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({
      name: "Read later",
      color: null,
    });

    const added = await teak("folders", "add", "Reading", "card_a", "card_b");
    expect(added.stdout).toContain("Added 1 card to Reading");
    expect(added.stderr).toContain(
      "card_b: already in the most folders a card can be in"
    );
    expect(added.code).toBe(EXIT.api);

    const missing = await teak("folders", "add", "Nope", "card_a");
    expect(missing.stderr).toContain("Folder not found: Nope");
    expect(missing.code).not.toBe(0);

    routes.set("GET /v1/cards", emptyPage);
    requests.length = 0;
    await teak("ls", "--folder", "Reading");
    expect(requests.at(-1)?.path).toContain("folder=folder_1");

    const removed = await teak("--json", "folders", "rm", "folder_1");
    expect(JSON.parse(removed.stdout)).toEqual({ deleted: ["folder_1"] });
  });

  test("folders: smart folders save a search and show it", async () => {
    const design = {
      id: "folder_3",
      name: "Design links",
      color: null,
      kind: "smart",
      query: "tag:design type:link",
      cardCount: null,
      createdAt: 1,
      updatedAt: 1,
    };
    routes.set("GET /v1/folders", () => json({ items: [design] }));
    routes.set("POST /v1/folders", () => json(design, 201));
    routes.set("PATCH /v1/folders/folder_3", () =>
      json({ ...design, query: "tag:design" })
    );
    routes.set("POST /v1/folders/folder_3/cards", () =>
      json(
        {
          code: "SMART_FOLDER",
          error:
            "Cards can't be added to a smart folder; it shows the cards that match its search",
        },
        409
      )
    );

    const created = await teak(
      "folders",
      "create",
      "Design links",
      "--query",
      "tag:design type:link"
    );
    expect(created.code).toBe(0);
    expect(created.stdout).toContain("smart: tag:design type:link");
    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({
      name: "Design links",
      kind: "smart",
      query: "tag:design type:link",
    });

    const listed = await teak("folders");
    expect(listed.stdout).toContain("folder_3     -  Design links  smart:");

    requests.length = 0;
    const edited = await teak(
      "folders",
      "rename",
      "design links",
      "--query",
      "tag:design"
    );
    expect(edited.stdout).toContain("smart: tag:design");
    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({
      query: "tag:design",
    });

    const refused = await teak("folders", "add", "Design links", "card_a");
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("Cards can't be added to a smart folder");
  });

  test("export download saves to the -o path", async () => {
    routes.set("GET /v1/exports/latest", () =>
      json({
        job: {
          id: "exp_1",
          status: "ready",
          cardCount: 3,
          createdAt: Date.UTC(2026, 9, 10),
          downloadUrl: `${server.url}files/export.zip`,
        },
        canStartNew: false,
        nextAvailableAt: null,
      })
    );
    routes.set("GET /files/export.zip", () => new Response("zip-bytes"));

    const result = await teak("export", "download", "-o", "chosen.zip");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Saved chosen.zip");
    expect(readFileSync(join(workDirectory, "chosen.zip"), "utf8")).toBe(
      "zip-bytes"
    );
    expect(existsSync(join(workDirectory, "teak-export-2026-10-10.zip"))).toBe(
      false
    );
  });

  test("open prints the link and exits cleanly when no browser can start", async () => {
    routes.set("GET /v1/cards/card_a", () => json(card("card_a")));

    // A PATH holding only an empty directory means xdg-open (or open) can't
    // be found. An empty PATH isn't enough: Bun then searches the default
    // system path, where CI runners have xdg-open.
    const emptyPath = mkdtempSync(join(tmpdir(), "teak-cli-no-browser-"));
    const result = await teakWithEnv({ PATH: emptyPath }, "open", "card_a");
    rmSync(emptyPath, { force: true, recursive: true });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("https://app.teakvault.com/?card=card_a");
    expect(result.stderr).toContain("Couldn't open a browser");
    expect(result.stderr).not.toContain("ENOENT");
  });

  test("bulk create accepts an {items} file and lists each result", async () => {
    routes.set("POST /v1/cards/bulk", () =>
      json({
        operation: "create",
        results: [
          { cardId: "card_new", index: 0, status: "success" },
          { cardId: "card_old", index: 2, resaved: true, status: "success" },
          {
            code: "INVALID_INPUT",
            error: "Each create item must include `content` or `url`",
            index: 1,
            status: "error",
          },
        ],
        summary: { failed: 1, succeeded: 1, total: 2 },
      })
    );
    const input = join(workDirectory, "bulk-items.json");
    writeFileSync(input, JSON.stringify({ items: [{ content: "a" }, {}] }));

    const result = await teak("cards", "bulk", "create", "--input", input);

    expect(result.code).toBe(EXIT.api);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      items: [{ content: "a" }, {}],
      operation: "create",
    });
    expect(result.stdout).toContain("1/2 succeeded");
    expect(result.stdout).toContain("[0] card_new\n");
    expect(result.stdout).toContain(
      "[2] card_old (already in Teak, moved to the top)"
    );
    expect(result.stdout).toContain(
      "[1] INVALID_INPUT: Each create item must include `content` or `url`"
    );
  });

  test("bulk input that is neither an array nor {items} is a usage error", async () => {
    const input = join(workDirectory, "bulk-bad.json");
    writeFileSync(input, JSON.stringify({ cards: [] }));

    const result = await teak("cards", "bulk", "create", "--input", input);

    expect(result.code).toBe(EXIT.usage);
    expect(requests).toHaveLength(0);
  });
});
