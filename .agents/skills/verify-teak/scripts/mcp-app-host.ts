#!/usr/bin/env bun
/**
 * Renders Teak's MCP App (the card view, `ui://teak/cards.html`) the way an
 * MCP Apps host such as Claude does, with real results from the running
 * stack's MCP server, and saves a screenshot of each view.
 *
 * It reads the view with `resources/read`, puts it in a sandboxed frame under
 * a Content-Security-Policy built from the resource's own `_meta.ui.csp`,
 * answers the view's `ui/initialize` with a theme, a locale and the tool's
 * name, then sends the tool's input and result. It clicks the first card or
 * "Open in Teak" and records the `ui/open-link` request.
 *
 * Usage (after `scripts/api-key.ts mint`):
 *   bun .agents/skills/verify-teak/scripts/mcp-app-host.ts <evidence-dir> [marker]
 * With a marker it also saves https://example.com/<marker> tagged with it, to
 * show the save confirmation; delete that card in cleanup.
 *
 * Exits 1 when a view breaks the CSP, throws, or shows a broken image.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const ROOT = join(import.meta.dir, "../../../..");
const keyFile = JSON.parse(
  readFileSync(join(ROOT, ".agents/.state/verify/api-key.json"), "utf8")
) as { apiUrl: string; key: string };

const [evidence, marker] = process.argv.slice(2);
if (!evidence) {
  console.error("Usage: mcp-app-host.ts <evidence-dir> [marker]");
  process.exit(2);
}
mkdirSync(evidence, { recursive: true });

type JsonObject = Record<string, unknown>;

let nextId = 1;
const rpc = async (method: string, params: JsonObject) => {
  const response = await fetch(`${keyFile.apiUrl}/mcp`, {
    body: JSON.stringify({ id: nextId++, jsonrpc: "2.0", method, params }),
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${keyFile.key}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    error?: unknown;
    result?: JsonObject;
  };
  if (body.error || !body.result) {
    throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  }
  return body.result;
};

const callTool = async (name: string, args: JsonObject) => ({
  input: args,
  name,
  result: await rpc("tools/call", { arguments: args, name }),
});

const resource = (
  (await rpc("resources/read", { uri: "ui://teak/cards.html" })).contents as {
    _meta: { ui: { csp: { resourceDomains: string[] } } };
    text: string;
  }[]
)[0];
if (!resource) {
  throw new Error("resources/read returned no contents");
}
const policy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  `img-src ${resource._meta.ui.csp.resourceDomains.join(" ")} data:`,
  "connect-src 'none'",
].join("; ");
const view = resource.text.replace(
  "<head>",
  `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`
);

const search = await callTool("teak_v1_search_cards", {
  limit: 12,
  q: "design",
});
const items = ((search.result.structuredContent as JsonObject).items ??
  []) as JsonObject[];
const first = items.find((item) => item.type === "link") ?? items[0];
const scenarios = [
  ["search", search],
  ["favorites", await callTool("teak_v1_list_favorite_cards", { limit: 12 })],
  [
    "recent",
    await callTool("teak_v1_list_cards", { limit: 12, sort: "newest" }),
  ],
  ...(first
    ? [["detail", await callTool("teak_v1_get_card", { cardId: first.id })]]
    : []),
  ...(marker
    ? [
        [
          "saved",
          await callTool("teak_v1_create_card", {
            tags: [marker],
            url: `https://example.com/${marker}`,
          }),
        ],
      ]
    : []),
] as const;
writeFileSync(
  join(evidence, "mcp-app-results.json"),
  JSON.stringify(scenarios, null, 2)
);

const hostPage = (
  theme: string
) => `<!doctype html><html><body style="margin:0;padding:16px;background:${theme === "dark" ? "#262624" : "#faf9f5"}">
<iframe id="view" sandbox="allow-scripts" style="border:0;width:648px;height:120px"></iframe>
<script>
  const frame = document.getElementById("view");
  window.__opened = [];
  window.addEventListener("message", (event) => {
    const m = event.data;
    if (event.source !== frame.contentWindow || !m || m.jsonrpc !== "2.0") return;
    const s = window.__scenario;
    const reply = (result) => frame.contentWindow.postMessage({ jsonrpc: "2.0", id: m.id, result }, "*");
    const notify = (method, params) => frame.contentWindow.postMessage({ jsonrpc: "2.0", method, params }, "*");
    if (m.method === "ui/initialize") reply({ protocolVersion: m.params.protocolVersion, hostInfo: { name: "verify-teak", version: "1" }, hostCapabilities: { openLinks: {} }, hostContext: { theme: s.theme, locale: s.locale, displayMode: "inline", toolInfo: { tool: { name: s.name, inputSchema: { type: "object" } } } } });
    if (m.method === "ui/notifications/initialized") { notify("ui/notifications/tool-input", { arguments: s.input }); notify("ui/notifications/tool-result", s.result); }
    if (m.method === "ui/notifications/size-changed") { frame.style.height = m.params.height + "px"; window.__height = m.params.height; }
    if (m.method === "ui/open-link") { window.__opened.push(m.params.url); reply({}); }
  });
</script></body></html>`;

const browser = await chromium.launch();
const report: JsonObject[] = [];
for (const [theme, locale] of [
  ["light", "en-US"],
  ["dark", "en-US"],
  ["light", "ja-JP"],
] as const) {
  for (const [label, call] of scenarios) {
    const page = await browser.newPage({
      colorScheme: theme,
      deviceScaleFactor: 2,
      viewport: { height: 1000, width: 680 },
    });
    const problems: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused/iu.test(message.text())) {
        problems.push(message.text());
      }
    });
    page.on("pageerror", (error) => problems.push(error.message));
    await page.setContent(hostPage(theme));
    await page.evaluate(
      ([scenario, html]) => {
        (window as unknown as { __scenario: unknown }).__scenario = scenario;
        (document.getElementById("view") as HTMLIFrameElement).srcdoc = html;
      },
      [{ ...call, locale, theme }, view] as const
    );
    await page.waitForFunction(
      () => ((window as unknown as { __height?: number }).__height ?? 0) > 40,
      null,
      { timeout: 15_000 }
    );
    const frame = page.frames()[1];
    await frame
      ?.waitForFunction(
        () => [...document.images].every((image) => image.complete),
        null,
        { timeout: 15_000 }
      )
      .catch(() => undefined);
    const images =
      (await frame?.evaluate(() =>
        [...document.images].map((image) => image.naturalWidth > 0)
      )) ?? [];
    await (await frame?.$("button.tile, button.primary"))?.click();
    await page.waitForTimeout(300);
    const file = `mcp-app-${label}-${theme}-${locale}.png`;
    await page.screenshot({ fullPage: true, path: join(evidence, file) });
    const brokenImages = images.filter((ok) => !ok).length;
    report.push({
      brokenImages,
      file,
      images: images.length,
      opened: await page.evaluate(
        () => (window as unknown as { __opened: string[] }).__opened
      ),
      problems,
      view: label,
    });
    await page.close();
  }
}
await browser.close();

writeFileSync(
  join(evidence, "mcp-app-report.json"),
  JSON.stringify(report, null, 2)
);
for (const row of report) {
  console.log(
    `${row.file}: ${row.images} images (${row.brokenImages} broken), ${(row.problems as string[]).length} problems, opened ${(row.opened as string[]).join(" ") || "-"}`
  );
}
const savedId = scenarios.find(([label]) => label === "saved")?.[1].result
  .structuredContent as JsonObject | undefined;
if (savedId?.cardId) {
  console.log(`saved card ${savedId.cardId}: delete it in cleanup`);
}
process.exit(
  report.some(
    (row) =>
      (row.problems as string[]).length > 0 || Number(row.brokenImages) > 0
  )
    ? 1
    : 0
);
