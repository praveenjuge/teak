import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MockId } from "./shots.ts";

/**
 * HTML for the docs' mock screens and diagrams. Each mock draws inside the
 * 1600 × 1000 meadow frame from render.ts, in Teak's own type, colors and
 * radius, so mocks and real captures read as one set. Card images come from
 * the store showcase (`scripts/store-assets/seed`).
 */

const root = path.resolve(import.meta.dir, "../..");
const seed = (file: string) =>
  pathToFileURL(path.join(root, "scripts/store-assets/seed", file)).href;

export const logoSvg = () =>
  readFileSync(path.join(root, "apps/docs/public/logos/logo-light.svg"), "utf8")
    .replace(/<title>.*?<\/title>/, "")
    .replace(/height="92"/, 'height="100%"')
    .replace(/width="260"/, 'width="100%"');

const esc = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Tiny highlighter: wrap `«k:word»` style tokens in spans. */
const code = (source: string) =>
  esc(source).replace(
    /«([a-z]):(.*?)»/g,
    (_, kind: string, text: string) => `<span class="t${kind}">${text}</span>`
  );

const icon = (name: keyof typeof ICONS, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

// Lucide paths, the icon set the web app and docs use.
const ICONS = {
  arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  sparkles:
    '<path d="M9.94 14.06 12 21l2.06-6.94L21 12l-6.94-2.06L12 3l-2.06 6.94L3 12z"/>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  messages: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  smartphone:
    '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  puzzle:
    '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
  command:
    '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  card: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/>',
  layers:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  credit:
    '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  flask:
    '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
} as const;

export const MOCK_CSS = `
  .t-k, .tk { color: oklch(0.72 0.17 330); }
  .ts { color: oklch(0.8 0.13 150); }
  .tf { color: oklch(0.8 0.12 250); }
  .tp { color: oklch(0.86 0.11 85); }
  .tc { color: oklch(0.6 0.02 260); }
  .tn { color: oklch(0.78 0.14 50); }
  .tg { color: oklch(0.78 0.15 155); }
  .tm { color: oklch(0.65 0.02 260); }
  .tr { color: oklch(0.7 0.19 27); }

  .window { display: flex; flex-direction: column; }
  .titlebar { flex: none; height: 56px; display: flex; align-items: center; gap: 16px;
    padding: 0 22px; border-bottom: 1px solid var(--border); background: oklch(0.985 0.002 247.839); }
  .titlebar.dark { background: oklch(0.18 0.03 262); border-color: oklch(0.27 0.03 260); color: var(--muted-dark); }
  .dots { display: flex; gap: 9px; }
  .dots i { width: 14px; height: 14px; border-radius: 50%; background: #ff5f57; }
  .dots i:nth-child(2) { background: #febc2e; } .dots i:nth-child(3) { background: #28c840; }
  .titlebar .title { flex: 1; text-align: center; font-size: 19px; font-weight: 500; margin-right: 66px; }
  .addr { flex: 1; height: 36px; border-radius: 999px; background: var(--secondary); color: var(--muted);
    display: flex; align-items: center; gap: 10px; padding: 0 18px; font-size: 18px; max-width: 760px; margin: 0 auto; }
  .addr b { color: var(--fg); font-weight: 500; }

  .term { flex: 1; background: var(--bg-dark); color: var(--ink-dark); font-family: var(--mono);
    font-size: 23px; line-height: 1.62; padding: 34px 40px; white-space: pre; }
  .term .prompt { color: var(--primary-dark); }

  .pill { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; border-radius: 999px;
    font-size: 17px; font-weight: 500; background: var(--secondary); color: var(--fg); }
  .pill.red { background: oklch(0.58 0.22 27 / 0.1); color: var(--primary); }
  .pill.green { background: oklch(0.72 0.15 155 / 0.14); color: oklch(0.48 0.12 155); }
  .chip { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 8px;
    background: var(--secondary); font-size: 16px; color: oklch(0.21 0.034 264.665); }
  .chip.dashed { background: none; border: 1.5px dashed var(--border); color: var(--muted); }

  .diagram { position: absolute; left: 112px; top: 70px; width: 1376px; height: 860px; border-radius: 28px;
    background: #fff; box-shadow: 0 30px 70px -10px rgba(25,40,28,.35), 0 0 0 1px rgba(25,40,28,.08);
    padding: 52px 60px; display: flex; flex-direction: column; }
  .diagram h2 { margin: 0; font-size: 34px; letter-spacing: -0.02em; font-weight: 650; }
  .diagram h2 + p { margin: 8px 0 0; font-size: 21px; color: var(--muted); }
  .diagram .body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .node { border: 1.5px solid var(--border); border-radius: 18px; background: #fff; padding: 20px 22px;
    display: flex; gap: 14px; align-items: flex-start; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  .node .ic { flex: none; width: 50px; height: 50px; border-radius: 12px; display: grid; place-items: center;
    background: var(--secondary); color: var(--fg); }
  .node.accent { border-color: oklch(0.58 0.22 27 / 0.45); background: oklch(0.58 0.22 27 / 0.04); }
  .node.accent .ic { background: var(--primary); color: #fff; }
  .node strong { display: block; font-size: 22px; font-weight: 600; }
  .node span { display: block; font-size: 17.5px; color: var(--muted); margin-top: 4px; line-height: 1.4; }
  .node code, .diagram code { font-family: var(--mono); font-size: 16px; color: oklch(0.38 0.03 262); }
  .arrow { color: oklch(0.7 0.02 262); display: grid; place-items: center; }
  .link { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 14px 0;
    color: var(--muted); font-size: 16px; }
  .link .pill { height: 30px; font-size: 15px; background: #fff; border: 1px solid var(--border); color: var(--muted); }
  .tag { display: inline-block; font-style: normal; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 6px; background: var(--secondary); color: var(--muted); margin-top: 8px; }
  .tag.req { background: oklch(0.58 0.22 27 / 0.1); color: var(--primary); }
`;

const toolbarIcon = () =>
  `<div style="width:66px;display:flex;justify-content:flex-end"><span style="width:34px;height:34px;border-radius:9px;background:oklch(0.58 0.22 27 / 0.1);display:grid;place-items:center"><img src="${pathToFileURL(path.join(root, "apps/docs/public/favicon.svg")).href}" style="width:20px;height:20px"></span></div>`;

const win = (
  title: string,
  body: string,
  opts: { address?: boolean; dark?: boolean; extension?: boolean } = {}
) => `
  <div class="window">
    <div class="titlebar${opts.dark ? " dark" : ""}">
      <div class="dots"><i></i><i></i><i></i></div>
      ${opts.address ? `<div class="addr">${icon("shield", 16)}${title}</div>${opts.extension ? toolbarIcon() : '<div style="width:66px"></div>'}` : `<div class="title">${title}</div>`}
    </div>
    ${body}
  </div>`;

const terminal = (title: string, lines: string) =>
  win(title, `<div class="term">${code(lines)}</div>`, { dark: true });

const SHOWCASE = [
  {
    file: "Axel Towers, Copenhagen.jpg",
    title: "Axel Towers, Copenhagen",
    tags: ["architecture", "light"],
  },
  {
    file: "Concrete skylights.jpg",
    title: "Concrete skylights",
    tags: ["architecture"],
  },
  {
    file: "White concrete curves.jpg",
    title: "White concrete curves",
    tags: ["architecture", "white"],
  },
  {
    file: "Spiral staircase.jpg",
    title: "Spiral staircase",
    tags: ["architecture", "stairs"],
  },
  { file: "Fallingwater.jpg", title: "Fallingwater", tags: ["architecture"] },
  {
    file: "Looking up, concrete.jpg",
    title: "Looking up, concrete",
    tags: ["architecture"],
  },
];

const thumb = (file: string, w: number, h: number, radius = 12) =>
  `<div style="width:${w}px;height:${h}px;border-radius:${radius}px;flex:none;background:url('${seed(file)}') center/cover"></div>`;

const cli = () =>
  terminal(
    "~ — zsh",
    `«r:~» teak add https://www.are.na/ --tags research
«m:j97cdypkx462tkah075fvysfxn8gywp8  https://app.teakvault.com/?card=j97cdypkx4…»

«r:~» teak search "architecture" --limit 6
«m:j97admp89f…»  «f:image»                 «g:#architecture #light»     «m:6m»
«m:j9711na4c0…»  «f:image»                 «g:#architecture #stairs»    «m:7m»
«m:j971y1z7n5…»  «f:image»                 «g:#architecture #white»     «m:8m»
«m:j97cdypkx4…»  «f:link»   «p:en.wikipedia.org/wiki/Bauhaus»  «g:#design #reading»  «m:9m»
«m:j978gjbmwt…»  «f:palette»  Kyoto moss #2F3A2F #5B6B4E …  «g:#color»      «m:9m»
«m:j9780br003…»  «f:quote»  Styles come and go. Good design …  «g:#quotes»   «m:9m»

«r:~» teak whoami
alex@example.com
Free plan · 76 of 200 cards
Language: English

«r:~» ▌`
  );

const development = () =>
  terminal(
    "teak — zsh",
    `«r:~/teak» bun run dev --detach
Starting the web stack in the background…
Teak dev stack for this checkout (main), on the shared dev deployment:
  Running at «f:http://localhost:3000». Stop it with «p:bun run dev --stop».
  Sign in as «p:dev+you@example.org» (WorkOS staging); its vault is seeded with sample cards.
  Ports: web 3000, docs 3001, extension 3003.

«r:~/teak» bun run doctor
  «g:✓» node-version: Node matches the pinned version
  «g:✓» deps-lock: node_modules was installed from this bun.lock
  «g:✓» convex-isolation: the shared dev deployment
  «g:✓» convex-generated: Convex generated bindings are present
  «g:✓» target-readiness: web Convex and WorkOS configuration is valid
  «m:~» ports: this checkout's stack is running at http://localhost:3000

«r:~/teak» ▌`
  );

const api = () => `
  <div class="window" style="flex-direction:row">
    <div style="width:700px;background:var(--bg-dark);display:flex;flex-direction:column">
      <div class="titlebar dark"><div class="dots"><i></i><i></i><i></i></div>
        <span style="font-size:18px">Request</span><span class="pill red" style="margin-left:auto;height:30px">POST /v1/cards</span></div>
      <div class="term" style="font-size:21px;line-height:1.75;padding:34px 32px">${code(`«r:$» curl https://teakvault.com/api/v1/cards \\
  --request «p:POST» \\
  --header «s:"Authorization: Bearer $TEAK_API_KEY"» \\
  --header «s:"Content-Type: application/json"» \\
  --header «s:"Idempotency-Key: first-card"» \\
  --data «s:'{»
    «s:"content": "https://www.are.na/",»
    «s:"tags": ["research"],»
    «s:"notes": "For the Halden moodboard"»
  «s:}'»`)}</div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;background:#fff">
      <div class="titlebar"><span style="font-size:18px;font-weight:500">Response</span>
        <span class="pill green" style="margin-left:auto;height:30px">200 OK</span></div>
      <pre style="margin:0;padding:34px 34px;font-family:var(--mono);font-size:21px;line-height:1.75;color:var(--fg)">{
  <span style="color:oklch(0.5 0.15 250)">"status"</span>: <span style="color:oklch(0.5 0.13 150)">"created"</span>,
  <span style="color:oklch(0.5 0.15 250)">"cardId"</span>: <span style="color:oklch(0.5 0.13 150)">"j97cdypkx462tkah…"</span>,
  <span style="color:oklch(0.5 0.15 250)">"appUrl"</span>: <span style="color:oklch(0.5 0.13 150)">"https://app.teakvault.com/?card=j97c…"</span>,
  <span style="color:oklch(0.5 0.15 250)">"card"</span>: {
    <span style="color:oklch(0.5 0.15 250)">"type"</span>: <span style="color:oklch(0.5 0.13 150)">"link"</span>,
    <span style="color:oklch(0.5 0.15 250)">"tags"</span>: [<span style="color:oklch(0.5 0.13 150)">"research"</span>],
    <span style="color:oklch(0.5 0.15 250)">"processingStatus"</span>: { … }
  }
}</pre>
      <div style="margin:auto 32px 32px;padding:18px;border:1.5px solid var(--border);border-radius:18px;display:flex;gap:18px;align-items:center">
        <div style="width:64px;height:64px;border-radius:14px;background:var(--secondary);display:grid;place-items:center;color:var(--muted)">${icon("globe", 30)}</div>
        <div style="flex:1"><div style="font-size:20px;font-weight:600">Are.na</div>
          <div style="font-size:16px;color:var(--muted);margin-top:4px">are.na · Saved just now</div>
          <div style="display:flex;gap:6px;margin-top:10px"><span class="chip">research</span><span class="chip dashed">AI tags on the way</span></div></div>
      </div>
    </div>
  </div>`;

const sdk = () =>
  win(
    "save.ts — reading-list",
    `<div style="flex:1;display:flex;background:var(--bg-dark);font-family:var(--mono);font-size:21px;line-height:1.7">
      <div style="padding:30px 18px 30px 26px;color:oklch(0.45 0.02 262);text-align:right;user-select:none">${Array.from({ length: 19 }, (_, i) => i + 1).join("<br>")}</div>
      <div style="padding:30px 20px;color:var(--ink-dark);white-space:pre">${code(`«k:import» { createTeakClient, staticTokenProvider } «k:from» «s:"teak-sdk"»;

«k:const» client = «f:createTeakClient»({
  «p:tokenProvider»: «f:staticTokenProvider»(process.env.«n:TEAK_API_KEY»!),
});

«c:// Save a link with a tag. Teak adds a summary and AI tags.»
«k:const» { cardId } = «k:await» client.cards.«f:create»({
  «p:content»: «s:"https://www.are.na/"»,
  «p:tags»: [«s:"research"»],
});

«c:// Search the library, by words and by meaning.»
«k:const» page = «k:await» client.cards.«f:search»({ «p:query»: «s:"architecture"» });

«k:for» («k:const» card «k:of» page.items) {
  console.«f:log»(card.type, card.tags.«f:join»(«s:", "»));
}`)}</div>
    </div>`,
    { dark: true }
  );

const mcp = () =>
  win(
    "Assistant",
    `<div style="flex:1;display:flex;flex-direction:column;gap:20px;padding:30px 110px 30px;background:#fff;font-size:21px;line-height:1.5">
      <div style="align-self:flex-end;max-width:720px;background:var(--secondary);padding:16px 22px;border-radius:22px 22px 6px 22px">
        Find the architecture references I saved for the Halden moodboard.</div>
      <div style="display:flex;align-items:center;gap:12px;color:var(--muted);font-size:18px">
        <span style="width:34px;height:34px;border-radius:10px;background:var(--primary);color:#fff;display:grid;place-items:center">${icon("wrench", 18)}</span>
        Called <b style="color:var(--fg);font-weight:600">teak_v1_search_cards</b>
        <code style="font-family:var(--mono);font-size:16px;background:var(--secondary);padding:4px 10px;border-radius:8px">{ "q": "architecture", "limit": 6 }</code>
        <span class="pill green" style="height:28px;font-size:15px">${icon("check", 15)} 6 cards</span></div>
      <div>I found six architecture cards in your Teak library. The strongest fits for a warm, minimal moodboard:</div>
      <div style="display:flex;gap:16px">
        ${SHOWCASE.slice(0, 5)
          .map(
            (
              card
            ) => `<div style="flex:1;border:1.5px solid var(--border);border-radius:16px;overflow:hidden">
              ${thumb(card.file, 210, 170, 0).replace("width:210px", "width:100%")}
              <div style="padding:10px 14px;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${card.title}</div></div>`
          )
          .join("")}
      </div>
      <div>Want me to put them in a <b>Halden</b> folder?</div>
      <div style="align-self:flex-end;background:var(--secondary);padding:14px 22px;border-radius:22px 22px 6px 22px">Yes, please.</div>
      <div style="display:flex;align-items:center;gap:12px;color:var(--muted);font-size:18px">
        <span style="width:34px;height:34px;border-radius:10px;background:var(--primary);color:#fff;display:grid;place-items:center">${icon("wrench", 18)}</span>
        Called <b style="color:var(--fg);font-weight:600">teak_v1_create_folder</b> and <b style="color:var(--fg);font-weight:600">teak_v1_add_cards_to_folder</b>
        <span class="pill green" style="height:28px;font-size:15px">${icon("check", 15)} Done</span></div>
      <div style="margin-top:auto;height:62px;border:1.5px solid var(--border);border-radius:999px;display:flex;align-items:center;padding:0 26px;color:var(--muted)">Reply…</div>
    </div>`
  );

const raycast = () => `
  <div class="window" style="left:200px;top:110px;width:1200px;height:780px;border-radius:24px;background:oklch(0.985 0.002 247.839)">
    <div style="height:78px;display:flex;align-items:center;gap:18px;padding:0 30px;border-bottom:1px solid var(--border);font-size:25px">
      <span style="color:var(--muted)">${icon("search", 26)}</span><span>architecture</span>
      <span style="margin-left:auto" class="pill">All types</span></div>
    <div style="flex:1;display:flex;min-height:0">
      <div style="width:520px;padding:14px;border-right:1px solid var(--border)">
        <div style="font-size:15px;font-weight:600;color:var(--muted);padding:6px 12px 10px">Cards</div>
        ${SHOWCASE.map(
          (
            card,
            i
          ) => `<div style="display:flex;align-items:center;gap:14px;padding:10px 12px;border-radius:12px;${i === 0 ? "background:oklch(0.58 0.22 27 / 0.1)" : ""}">
            ${thumb(card.file, 44, 44, 8)}<span style="flex:1;font-size:19px;font-weight:${i === 0 ? 600 : 500}">${card.title}</span>
            <span style="font-size:15px;color:var(--muted)">#${card.tags[0]}</span></div>`
        ).join("")}
      </div>
      <div style="flex:1;padding:26px 30px;display:flex;flex-direction:column;gap:18px">
        ${thumb(SHOWCASE[0].file, 618, 260, 16)}
        <div style="font-size:24px;font-weight:650">${SHOWCASE[0].title}</div>
        <div style="font-size:17px;color:var(--muted);line-height:1.5">Two leaning towers wrapped in glass and copper-colored louvers, photographed from below against a clear sky.</div>
        <div style="display:flex;gap:8px">${SHOWCASE[0].tags.map((tag) => `<span class="chip">${tag}</span>`).join("")}</div>
        <div style="border-top:1px solid var(--border);padding-top:14px;display:grid;grid-template-columns:auto 1fr;gap:10px 30px;font-size:17px">
          <span style="color:var(--muted)">Type</span><span>Image</span>
          <span style="color:var(--muted)">Saved</span><span>Today</span>
          <span style="color:var(--muted)">Colors</span><span style="display:flex;gap:6px">${["#2b2b2b", "#6b6f72", "#c9cbcc", "#eeeeec"].map((c) => `<i style="width:20px;height:20px;border-radius:50%;background:${c};display:block"></i>`).join("")}</span>
        </div>
      </div>
    </div>
    <div style="height:60px;display:flex;align-items:center;gap:14px;padding:0 24px;border-top:1px solid var(--border);font-size:17px;color:var(--muted)">
      <span style="width:62px;height:22px;display:block">${logoSvg()}</span><span>Search Cards</span>
      <span style="margin-left:auto;color:var(--fg);font-weight:500">Open in Teak</span><span class="chip" style="height:26px">↵</span>
      <span style="color:var(--fg);font-weight:500;margin-left:12px">Actions</span><span class="chip" style="height:26px">⌘ K</span></div>
  </div>`;

const extension = () => `
  ${win(
    "interfacecraft.example/notes/rhythm",
    `<div style="flex:1;background:#fff;padding:60px 110px;position:relative;display:flex;flex-direction:column;gap:26px;max-width:860px">
      <div style="font-size:16px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase">Notes on interface craft · 8 min read</div>
      <div style="font-size:52px;font-weight:700;letter-spacing:-.03em;line-height:1.08">Vertical rhythm, and why your type feels off</div>
      <div style="font-size:21px;line-height:1.65;color:oklch(0.35 0.02 262)">Good spacing is invisible. Line height, margins and the baseline grid decide whether a page reads as calm or cramped. Start with one unit, and let every gap be a multiple of it.</div>
      ${thumb("Design system on screen.jpg", 640, 300, 16)}
    </div>`,
    { address: true, extension: true }
  )}
  <div style="position:absolute;right:136px;top:132px;width:430px;background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:0 30px 60px -12px rgba(15,23,42,.35);font-size:17px">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px 22px">
      <span style="width:66px;height:24px;display:block">${logoSvg()}</span>
      <span style="display:flex;align-items:center;gap:6px;font-weight:500">Open Teak ${icon("arrowUpRight", 16)}</span></div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:18px;padding:22px 30px 26px">
      <div style="width:56px;height:56px;border-radius:50%;background:oklch(0.72 0.15 155 / 0.15);color:oklch(0.55 0.14 155);display:grid;place-items:center">${icon("check", 28)}</div>
      <div style="font-size:21px;font-weight:600">Saved to Teak</div>
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;flex-wrap:wrap;gap:6px;border:1.5px solid oklch(0.707 0.022 261.325);border-radius:10px;padding:7px;box-shadow:0 0 0 4px oklch(0.707 0.022 261.325 / 0.2)">
          <span class="chip" style="height:28px">typography</span><span class="chip" style="height:28px">reading</span>
          <span style="color:var(--muted);padding:3px 4px">|</span></div>
        <div style="display:flex;gap:6px"><span class="chip dashed" style="height:28px">design</span><span class="chip dashed" style="height:28px">spacing</span><span class="chip dashed" style="height:28px">layout</span></div>
        <div style="position:relative;border:1.5px solid var(--border);border-radius:10px;padding:12px 14px;min-height:70px;line-height:1.45">Read before the Halden type review.
          <span style="position:absolute;right:12px;bottom:8px;font-size:14px;color:oklch(0.55 0.14 155);display:flex;gap:4px;align-items:center">${icon("check", 13)} Saved</span></div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);padding:10px 12px 10px 22px;font-size:15px">
      <span style="flex:1;color:var(--muted)">alex@example.com</span><span style="padding:6px 10px">Sign out</span>
      <span style="display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:999px;padding:6px 12px">${icon("upload", 15)} Upload file</span></div>
  </div>`;

const webmcp = (library: string) =>
  win(
    "app.teakvault.com",
    `<div style="flex:1;display:flex;min-height:0">
      <div style="flex:1;overflow:hidden;background:url('${library}') left top/auto 100% no-repeat"></div>
      <div style="width:400px;border-left:1px solid var(--border);background:oklch(0.985 0.002 247.839);padding:24px;display:flex;flex-direction:column;gap:16px;font-size:17px">
        <div style="display:flex;align-items:center;gap:10px;font-weight:600;font-size:19px">${icon("bot", 22)} Agent</div>
        <div style="color:var(--muted)">This page offers 3 WebMCP tools</div>
        ${[
          ["teak_search_cards", "Read-only"],
          ["teak_get_card", "Read-only"],
          ["teak_search_form", "Declarative"],
        ]
          .map(
            ([
              name,
              kind,
            ]) => `<div style="background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:12px 14px">
              <div style="font-family:var(--mono);font-size:16px;font-weight:600">${name}</div>
              <span class="pill ${kind === "Read-only" ? "green" : ""}" style="height:24px;font-size:13px;margin-top:8px">${kind}</span></div>`
          )
          .join("")}
        <div style="margin-top:6px;background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:14px;line-height:1.45">
          <div style="font-size:14px;color:var(--muted);margin-bottom:6px">teak_search_cards · { "q": "architecture" }</div>
          Found 6 cards in your library. The first is <b>Axel Towers, Copenhagen</b>.</div>
        <div style="margin-top:auto;height:50px;border:1.5px solid var(--border);border-radius:999px;background:#fff;display:flex;align-items:center;padding:0 18px;color:var(--muted)">Ask about this page…</div>
      </div>
    </div>`,
    { address: true }
  );

const node = (
  ic: keyof typeof ICONS,
  title: string,
  text: string,
  extra = ""
) =>
  `<div class="node ${extra}"><div class="ic">${icon(ic, 24)}</div><div><strong>${title}</strong><span>${text}</span></div></div>`;

const arrow = (dir: "down" | "right" | "left" | "up", size = 30) => {
  const rotate = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return `<div class="arrow" style="transform:rotate(${rotate}deg)">${icon("arrowRight", size)}</div>`;
};

const aiAgents = () => `
  <div class="diagram">
    <h2>One library, every agent</h2>
    <p>Each way in reads and writes the same cards, with an OAuth sign-in or a <code>teakapi_</code> key.</p>
    <div class="body"><div style="display:grid;grid-template-columns:1fr 60px 300px;gap:0 24px;align-items:center">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        ${node("bot", "AI assistants", "Remote MCP at <code>teakvault.com/mcp</code>")}
        ${node("messages", "ChatGPT", "The Teak app, a connector on MCP")}
        ${node("code", "Your scripts", "REST API and the <code>teak-sdk</code> client")}
        ${node("terminal", "Terminal agents", "The <code>teak</code> CLI and its skill")}
        ${node("globe", "In your browser", "WebMCP tools in the signed-in web app")}
        ${node("file", "Docs for agents", "<code>llms.txt</code> and a Markdown copy of every page")}
      </div>
      ${arrow("right", 40)}
      <div class="node accent" style="flex-direction:column;align-items:center;text-align:center;padding:34px 26px">
        <div style="width:170px;height:60px">${logoSvg()}</div>
        <strong style="margin-top:18px;font-size:24px">Your Teak library</strong>
        <span>Search, save, tag, organize and read cards</span>
      </div>
    </div></div>
  </div>`;

const connector = (label: string) =>
  `<div class="link">${arrow("down", 26)}<span class="pill">${label}</span></div>`;

const architecture = () => `
  <div class="diagram">
    <h2>How Teak fits together</h2>
    <p>Every app talks to one Convex backend; two Cloudflare Workers handle files, background work and email.</p>
    <div class="body">
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px">
      ${[
        ["globe", "Web", "Next.js"],
        ["smartphone", "Apple", "SwiftUI"],
        ["smartphone", "Android", "Compose"],
        ["puzzle", "Extension", "WXT"],
        ["command", "Raycast", "Raycast API"],
        ["terminal", "CLI · MCP", "Your scripts"],
      ]
        .map(
          ([ic, t, s]) =>
            `<div class="node" style="flex-direction:column;gap:10px;padding:18px"><div class="ic">${icon(ic as keyof typeof ICONS, 24)}</div><div><strong>${t}</strong><span>${s}</span></div></div>`
        )
        .join("")}
    </div>
    ${connector("Convex queries and mutations · REST API and MCP")}
    <div style="display:grid;grid-template-columns:280px 1fr 280px;gap:20px;align-items:stretch">
      ${node("key", "WorkOS AuthKit", "Sign-in for every surface, in every environment")}
      <div class="node accent" style="padding:24px 26px">
        <div class="ic">${icon("database", 24)}</div>
        <div><strong>Convex</strong><span>Schema, queries, mutations and actions, the REST API and MCP server, the workflow dispatch outbox and keyword search</span></div>
      </div>
      ${node("mail", "Email Worker", "Save by email: signed requests to Convex")}
    </div>
    ${connector("Workflow dispatch · signed workflow gateway")}
    <div class="node" style="padding:22px 26px;border-color:oklch(0.75 0.12 60 / 0.6);background:oklch(0.8 0.12 70 / 0.06)">
      <div class="ic" style="background:oklch(0.8 0.12 70 / 0.18)">${icon("cloud", 24)}</div>
      <div style="flex:1"><strong>Files Worker</strong><span>Card-processing Workflows, uploads, imports, exports and the API edge proxy</span>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">${[
          "R2 files",
          "Workers AI",
          "Vectorize",
          "Media containers",
          "Browser Run",
          "Cron Triggers",
        ]
          .map(
            (label) =>
              `<span class="pill" style="height:32px;font-size:16px;background:#fff;border:1px solid var(--border)">${label}</span>`
          )
          .join("")}</div></div>
    </div>
    </div>
  </div>`;

const STEPS = [
  ["Internal function", "packages/convex/publicApi*.ts"],
  ["HTTP handler", "publicApi/http/*.ts"],
  ["Route and OPTIONS", "http.ts"],
  ["OpenAPI operation", "publicApi/openApi/"],
  ["MCP tool", "mcp/tools.ts"],
  ["SDK method", "packages/sdk/src/index.ts"],
  ["CLI command", "apps/cli/src/index.ts"],
  ["Parity row", "scripts/public-parity.ts"],
];

const addingAFeature = () => `
  <div class="diagram">
    <h2>One feature, every surface</h2>
    <p>A public API feature ships on MCP, the SDK and the CLI in the same pull request, in this order.</p>
    <div class="body"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:30px 34px">
      ${STEPS.map(
        (
          [title, file],
          i
        ) => `<div class="node${i === 7 ? " accent" : ""}" style="flex-direction:column;gap:12px;position:relative;min-height:176px">
          <div class="ic" style="${i === 7 ? "" : "background:oklch(0.58 0.22 27 / 0.1);color:var(--primary)"};font-weight:700;font-size:21px">${i + 1}</div>
          <div><strong>${title}</strong><code>${file}</code></div>
          ${i % 4 === 3 ? "" : `<div style="position:absolute;right:-34px;top:50%;transform:translateY(-50%);width:34px">${arrow("right", 24)}</div>`}
        </div>`
      ).join("")}
    </div>
    <div style="margin-top:44px;display:flex;align-items:center;gap:16px;background:oklch(0.72 0.15 155 / 0.1);border-radius:18px;padding:22px 26px">
      <span style="width:44px;height:44px;border-radius:50%;background:oklch(0.72 0.15 155 / 0.2);color:oklch(0.5 0.13 155);display:grid;place-items:center">${icon("check", 24)}</span>
      <div style="font-size:19px"><b>scripts/public-parity.test.ts</b> calls every MCP tool and SDK method and walks the CLI, so a missed step fails <code>bun run test</code>.</div>
    </div></div>
  </div>`;

const selfHosting = () => `
  <div class="diagram">
    <h2>What a self-hosted Teak runs</h2>
    <p>The same pieces as teakvault.com, on accounts you own.</p>
    <div class="body">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
      ${node("globe", "Web app", "<code>apps/web</code> on Vercel or any Next.js host<br><i class='tag req'>Required</i>")}
      ${node("database", "Convex deployment", "Data, functions, REST API and MCP<br><i class='tag req'>Required</i>", "accent")}
      ${node("key", "WorkOS AuthKit", "Email and password, plus Google or Apple<br><i class='tag req'>Required</i>")}
    </div>
    ${connector("Workflow dispatch · signed URLs for files")}
    <div class="node" style="padding:24px 26px">
      <div class="ic">${icon("cloud", 24)}</div>
      <div style="flex:1"><strong>Files Worker on Cloudflare Workers Paid</strong>
        <span>File storage in R2, thumbnails, screenshots, media processing, AI tags and summaries, and search by meaning</span>
        <i class="tag req">Required for files and AI</i></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px">
      ${node("credit", "Polar", "Billing and the Pro plan<br><i class='tag'>Optional</i>")}
      ${node("mail", "Email Worker", "Save by email through Cloudflare Email Routing<br><i class='tag'>Optional</i>")}
    </div>
    </div>
  </div>`;

const LAYERS = [
  [
    "A real browser flow or a journey",
    "e2e against the local stack and the WorkOS emulator",
    "packages/tests",
  ],
  [
    "Web React UI",
    "bun test + renderToStaticMarkup",
    "apps/web/src/**/__tests__",
  ],
  [
    "Files Worker Workflow engine behavior",
    "bun test + Wrangler createTestHarness",
    "apps/files-worker/src",
  ],
  [
    "Convex on the real database",
    "convex-test on Vitest",
    "packages/convex/edge",
  ],
  [
    "Convex function logic",
    "bun test + test helpers",
    "packages/convex/__tests__",
  ],
  ["Pure functions", "bun test", "beside the code"],
];

const testing = () => `
  <div class="diagram">
    <h2>Pick the lowest layer that can see it</h2>
    <p>Move up a layer only when the behavior lives in the integration: an index, a session, a browser API.</p>
    <div style="display:flex;gap:30px;margin-top:34px;flex:1;align-items:stretch">
      <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;gap:12px;align-items:center">
        ${LAYERS.map(
          (
            [title, tool, where],
            i
          ) => `<div class="node" style="width:${62 + i * 7.6}%;align-items:center;padding:18px 22px;${i === LAYERS.length - 1 ? "border-color:oklch(0.58 0.22 27 / 0.45);background:oklch(0.58 0.22 27 / 0.04)" : ""}">
            <div style="flex:1"><strong style="font-size:21px">${title}</strong><span>${tool}</span></div><code>${where}</code></div>`
        ).join("")}
      </div>
      <div style="width:70px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;color:var(--muted);font-size:15px;text-align:center">
        <span>Slower, wider</span><div style="flex:1;width:3px;margin:12px 0;border-radius:2px;background:linear-gradient(var(--border),var(--primary))"></div><span style="color:var(--primary);font-weight:600">Start here</span>
      </div>
    </div>
  </div>`;

export const renderMock = (
  id: MockId,
  captures: { library: string }
): string => {
  switch (id) {
    case "adding-a-feature":
      return addingAFeature();
    case "ai-agents":
      return aiAgents();
    case "api":
      return api();
    case "architecture":
      return architecture();
    case "cli":
      return cli();
    case "development":
      return development();
    case "extension":
      return extension();
    case "mcp":
      return mcp();
    case "raycast":
      return raycast();
    case "sdk":
      return sdk();
    case "self-hosting":
      return selfHosting();
    case "testing":
      return testing();
    case "webmcp":
      if (!existsSync(new URL(captures.library))) {
        throw new Error(
          "webmcp needs the library capture: run capture.ts first"
        );
      }
      return webmcp(captures.library);
    default:
      throw new Error(`Unknown mock: ${id satisfies never}`);
  }
};
