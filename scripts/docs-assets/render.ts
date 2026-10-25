import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";
import {
  browserPath,
  CACHE,
  type CaptureMeta,
  captureFile,
  VIEWPORT,
} from "./common.ts";
import { MOCK_CSS, renderMock } from "./mocks.ts";
import { DOCS_IMAGES, SHOTS, type Shot } from "./shots.ts";

/**
 * Frames every shot on the meadow at 1600 × 1000 and writes it as WebP.
 * Web shots need `capture.ts` first; mocks render from HTML alone. Pass shot
 * names to render only those.
 */

const root = path.resolve(import.meta.dir, "../..");
export const SIZE = { width: 1600, height: 1000 };
// The window every capture and mock sits in.
const WINDOW = { left: 112, top: 70, width: 1376, height: 860 };
const QUALITY = 0.86;

const file = (relative: string) =>
  pathToFileURL(path.join(root, relative)).href;

const base = () => `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "SN Pro"; font-weight: 200 900;
    src: url("${file("apps/docs/public/fonts/SNPro-VariableRegular.woff2")}") format("woff2"); }
  :root {
    --fg: oklch(0.13 0.028 261.692); --muted: oklch(0.551 0.027 264.364);
    --border: oklch(0.928 0.006 264.531); --secondary: oklch(0.967 0.003 264.542);
    --primary: oklch(0.58 0.22 27); --primary-dark: oklch(0.7 0.19 27);
    --bg-dark: oklch(0.16 0.03 262); --ink-dark: oklch(0.96 0.005 250); --muted-dark: oklch(0.707 0.022 261.325);
    --mono: "JetBrains Mono", "SF Mono", Menlo, ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; width: ${SIZE.width}px; height: ${SIZE.height}px; overflow: hidden; position: relative;
    font-family: "SN Pro", system-ui, sans-serif; color: var(--fg); -webkit-font-smoothing: antialiased;
    background: #e4eadc url("${file("scripts/store-assets/wallpaper.jpg")}") center / cover; }
  body::before { content: ""; position: absolute; inset: 0;
    background: linear-gradient(rgba(248,250,242,.32), rgba(248,250,242,.08) 45%, rgba(248,250,242,0)); }
  .window { position: absolute; left: ${WINDOW.left}px; top: ${WINDOW.top}px; width: ${WINDOW.width}px;
    height: ${WINDOW.height}px; border-radius: 20px; overflow: hidden; background: #fff;
    box-shadow: 0 32px 70px -12px rgba(25,40,28,.38), 0 0 0 1px rgba(25,40,28,.1); }
  .shot { display: block; width: 100%; height: 100%; }
  .panel { position: absolute; border-radius: 22px; overflow: hidden; background: #fff;
    box-shadow: 0 32px 70px -12px rgba(25,40,28,.4), 0 0 0 1px rgba(25,40,28,.1); }
  .marker { position: absolute; z-index: 3; width: 46px; height: 46px; border-radius: 50%;
    background: var(--primary); color: #fff; font: 700 23px/1 "SN Pro", sans-serif;
    display: grid; place-items: center; border: 3px solid #fff;
    box-shadow: 0 8px 18px rgba(30,20,20,.3); transform: translate(-50%, -50%); }
  ${MOCK_CSS}
</style>`;

const markers = (meta: CaptureMeta, left: number, top: number, scale: number) =>
  (meta.markers ?? [])
    .map(
      ({ n, x, y }) =>
        `<div class="marker" style="left:${left + x * scale - 30}px;top:${top + y * scale}px">${n}</div>`
    )
    .join("");

const pngSize = (png: string) => {
  const bytes = readFileSync(png);
  return {
    width: bytes.readUInt32BE(16) / 2,
    height: bytes.readUInt32BE(20) / 2,
  };
};

/** A raw capture keeps its shape, at most 1600 px wide. */
const rawSize = (png: string) => {
  if (!existsSync(png)) {
    throw new Error(
      `Missing capture: ${path.relative(root, png)}: run capture.ts first`
    );
  }
  const { width, height } = pngSize(png);
  const scale = Math.min(1, SIZE.width / (width * 2));
  return {
    width: Math.round(width * 2 * scale),
    height: Math.round(height * 2 * scale),
  };
};

const webHtml = (shot: Extract<Shot, { kind: "web" }>) => {
  const png = captureFile(shot.name);
  if (!existsSync(png)) {
    throw new Error(`Missing capture for ${shot.name}: run capture.ts first`);
  }
  const src = pathToFileURL(png).href;
  const meta = JSON.parse(
    readFileSync(path.join(CACHE, `${shot.name}.json`), "utf8")
  ) as CaptureMeta;
  if (shot.layout === "window") {
    const scale = WINDOW.width / VIEWPORT.width;
    return `<div class="window"><img class="shot" src="${src}"></div>${markers(meta, WINDOW.left, WINDOW.top, scale)}`;
  }
  const { width, height } = pngSize(png);
  const scale = Math.min(WINDOW.width / width, WINDOW.height / height, 1.7);
  const w = width * scale;
  const h = height * scale;
  const left = (SIZE.width - w) / 2;
  const top = (SIZE.height - h) / 2;
  return `<div class="panel" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px"><img class="shot" src="${src}"></div>${markers(meta, left, top, scale)}`;
};

const settle = async (page: Page) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => undefined))
    );
    // Background images: wait for each to load before the screenshot.
    const urls = [...document.querySelectorAll<HTMLElement>("[style*='url(']")]
      .map((el) => /url\(['"]?(.*?)['"]?\)/.exec(el.style.backgroundImage)?.[1])
      .filter((url): url is string => Boolean(url));
    await Promise.all(
      urls.map(
        (url) =>
          new Promise((resolve) => {
            const image = new Image();
            image.onload = resolve;
            image.onerror = resolve;
            image.src = url;
          })
      )
    );
  });
};

const toWebp = async (page: Page, png: Buffer) => {
  const dataUrl = await page.evaluate(
    async ({ base64, quality }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", quality);
    },
    { base64: png.toString("base64"), quality: QUALITY }
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
};

if (import.meta.main) {
  const wanted = process.argv.slice(2);
  const shots = SHOTS.filter(
    (shot) => !wanted.length || wanted.includes(shot.name)
  );
  const unknown = wanted.filter(
    (name) => !SHOTS.some((shot) => shot.name === name)
  );
  if (unknown.length) {
    throw new Error(`Unknown shots: ${unknown.join(", ")}`);
  }
  const htmlDir = path.join(CACHE, "html");
  mkdirSync(htmlDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: browserPath(),
    args: ["--allow-file-access-from-files"],
  });
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  const library = pathToFileURL(captureFile("library")).href;
  for (const shot of shots) {
    const raw = shot.kind === "web" && shot.layout === "raw";
    const size = raw ? rawSize(captureFile(shot.name)) : SIZE;
    const body = raw
      ? `<body style="width:${size.width}px;height:${size.height}px;background:#fff"><img class="shot" src="${pathToFileURL(captureFile(shot.name)).href}"></body>`
      : `<body>${shot.kind === "web" ? webHtml(shot) : renderMock(shot.mock, { library })}</body>`;
    const html = path.join(htmlDir, `${shot.name}.html`);
    writeFileSync(
      html,
      `${base()}${raw ? "<style>body::before{display:none}</style>" : ""}${body}`
    );
    await page.setViewportSize(size);
    await page.goto(pathToFileURL(html).href);
    await settle(page);
    const png = await page.screenshot({ type: "png" });
    const out = path.join(root, shot.out ?? DOCS_IMAGES, `${shot.name}.webp`);
    mkdirSync(path.dirname(out), { recursive: true });
    const webp = await toWebp(page, png);
    writeFileSync(out, webp);
    console.log(
      `rendered ${path.relative(root, out)} (${Math.round(webp.length / 1024)} KB)`
    );
  }
  await browser.close();
}
