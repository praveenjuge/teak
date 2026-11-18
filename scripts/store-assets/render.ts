import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { FEATURE_GRAPHIC, STORES, type StoreId } from "./shots.ts";

const root = path.resolve(import.meta.dir, "../..");
const cache = path.join(import.meta.dir, ".cache");
const ink = "#253529";

const dataURI = (file: string, type = "image/png") => {
  if (!existsSync(file)) {
    throw new Error(`Missing capture: ${path.relative(root, file)}`);
  }
  return `data:${type};base64,${readFileSync(file).toString("base64")}`;
};

const run = async (cmd: string[], cwd?: string) => {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${cmd.slice(0, 3).join(" ")} failed:\n${err || out}`);
  }
  return out;
};

const frameCaptures = async (id: StoreId): Promise<Map<string, string>> => {
  const store = STORES[id];
  if (!store.frame) {
    throw new Error(`${id} has no device frame`);
  }
  const dir = path.join(cache, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { device, size } = store.frame;
  const screens = store.shots
    .map(
      ({ name }) => `  ${JSON.stringify(name)}:
    background: { type: transparent }
    content:
      - type: image
        asset: ${JSON.stringify(path.join(root, store.sourceDir, `${name}.png`))}
        frame: true
        position: ["50%", "50%"]
        scale: 1.0`
    )
    .join("\n");
  const config = path.join(dir, "koubou.yaml");
  writeFileSync(
    config,
    `project:\n  name: teak\n  output_dir: framed\n  device: "${device}"\n  output_size: [${size.join(", ")}]\nscreenshots:\n${screens}\n`
  );
  await run(
    [
      "asc",
      "screenshots",
      "frame",
      "--config",
      config,
      "--output-dir",
      path.join(dir, "receipts"),
    ],
    dir
  );
  const framed = new Map<string, string>();
  for (const { name } of store.shots) {
    const file = path.join(
      dir,
      "framed",
      device.replaceAll(" ", "_"),
      `${name}.png`
    );
    framed.set(name, dataURI(file));
  }
  return framed;
};

// Allo, the web app's font, embedded so headlines never fall back.
const allo = dataURI(
  path.join(root, "apps/web/src/styles/fonts/AlloVariableFriendly.woff2"),
  "font/woff2"
);

const base = (width: number, height: number, wallpaper: string) => `
  @font-face { font-family: "Allo"; src: url(${allo}) format("woff2"); font-weight: 100 900; }
  * { box-sizing: border-box; }
  body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; position: relative;
    font-family: "Allo", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
    font-feature-settings: "ss01";
    background: #e4eadc; color: ${ink}; -webkit-font-smoothing: antialiased; }
  body::before { content: ''; position: absolute; inset: 0; background: url(${wallpaper}) center top/cover; }
  body::after { content: ''; position: absolute; inset: 0;
    background: linear-gradient(rgba(248,250,242,.28), rgba(248,250,242,.06) 40%, rgba(248,250,242,0)); }
  h1 { position: absolute; z-index: 2; left: 0; right: 0; margin: 0 auto; text-align: center;
    font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; text-wrap: balance; }
  .shot { position: absolute; z-index: 1; }
`;

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

// Every headline sets in exactly two lines. data-max is the widest a
// headline may run; fitHeadline narrows it to the least width that still
// fits two lines, and text-wrap: balance evens them.
const headline = (text: string, max: number, tag = "h1") =>
  `<${tag} data-max="${max}">${escapeHtml(text)}</${tag}>`;

const pageFor = {
  mac: (text: string, capture: string, overlay?: string) => `
    <style>
      h1 { top: 26px; font-size: 34px; font-weight: 600; }
      .shot { top: 118px; left: 160px; width: 1120px; height: 756px;
        display: flex; align-items: center; justify-content: center; }
      .shot img { max-width: 100%; max-height: 100%; object-fit: contain;
        filter: drop-shadow(0 18px 30px rgba(25,40,28,.22)); }
      /* Captures are 2x, so half their pixel width is their real size. */
      .shot img.panel { position: absolute; top: 46%; left: 50%; max-width: none; max-height: none;
        transform: translate(-50%, -50%); filter: drop-shadow(0 28px 56px rgba(25,40,28,.34)); }
    </style>
    ${headline(text, 1000)}
    <div class="shot"><img src="${capture}">${overlay ? `<img class="panel" src="${overlay}">` : ""}</div>`,
  raycast: (text: string, capture: string) => `
    <style>
      h1 { top: 24px; font-size: 30px; font-weight: 600; }
      .shot { top: 112px; left: 0; right: 0; margin: 0 auto; width: 750px; }
      /* Window captures are 2x, so 750px shows Raycast at its real size. */
      .shot img { width: 100%; display: block;
        filter: drop-shadow(0 22px 36px rgba(25,40,28,.3)); }
    </style>
    ${headline(text, 760)}
    <div class="shot"><img src="${capture}"></div>`,
  phone: (text: string, framed: string) => `
    <style>
      h1 { top: 64px; font-size: 40px; line-height: 1.08; }
      .shot { top: 196px; left: 0; right: 0; margin: 0 auto; width: 392px;
        filter: drop-shadow(0 24px 40px rgba(25,40,28,.28)); }
      .shot img { width: 100%; display: block; }
    </style>
    ${headline(text, 380)}
    <div class="shot"><img class="trim" src="${framed}"></div>`,
  tablet: (text: string, framed: string) => `
    <style>
      h1 { top: 64px; font-size: 52px; line-height: 1.08; }
      .shot { top: 216px; left: 0; right: 0; margin: 0 auto; width: 780px;
        filter: drop-shadow(0 30px 50px rgba(25,40,28,.28)); }
      .shot img { width: 100%; display: block; }
    </style>
    ${headline(text, 860)}
    <div class="shot"><img class="trim" src="${framed}"></div>`,
  android: (text: string, capture: string) => `
    <style>
      h1 { top: 44px; font-size: 30px; line-height: 1.1; }
      .shot { top: 140px; left: 0; right: 0; margin: 0 auto; width: 288px; padding: 8px;
        background: #1d1f1c; border-radius: 44px;
        box-shadow: inset 0 0 0 1.5px #4a4d48, 0 22px 40px rgba(25,40,28,.3); }
      .shot img { width: 100%; display: block; border-radius: 36px; }
      .shot::after { content: ''; position: absolute; top: 19px; left: 50%; width: 11px; height: 11px;
        margin-left: -5.5px; border-radius: 50%; background: #0b0c0b; }
    </style>
    ${headline(text, 310)}
    <div class="shot"><img src="${capture}"></div>`,
};

const trimImages = (page: Page) =>
  page.$$eval("img.trim", async (images) => {
    for (const image of images as HTMLImageElement[]) {
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        continue;
      }
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );
      let [top, left, bottom, right] = [height, width, 0, 0];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] > 8) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
      }
      const out = document.createElement("canvas");
      out.width = right - left + 1;
      out.height = bottom - top + 1;
      out.getContext("2d")?.drawImage(canvas, -left, -top);
      image.src = out.toDataURL("image/png");
      await image.decode();
    }
  });

const fitHeadline = async (page: Page, text: string, selector = "h1") => {
  const fit = await page.$eval(selector, (element) => {
    const heading = element as HTMLElement;
    const max = Number(heading.dataset.max);
    const lineHeight = Number.parseFloat(getComputedStyle(heading).lineHeight);
    const setAt = (width: number) => {
      heading.style.width = `${width}px`;
      return {
        lines: Math.round(heading.getBoundingClientRect().height / lineHeight),
        overflow: heading.scrollWidth > heading.clientWidth + 1,
      };
    };
    // A word wider than the box overflows instead of wrapping, so a width
    // fits only when it sets in two lines or fewer with nothing sticking out.
    const fits = (width: number) => {
      const { lines, overflow } = setAt(width);
      return lines <= 2 && !overflow;
    };
    if (!fits(max)) {
      return setAt(max);
    }
    let [low, high] = [1, max];
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(middle)) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    // One pixel of slack so rounding never pushes a word to a third line.
    return setAt(Math.min(high + 1, max));
  });
  if (fit.lines > 2 || fit.overflow) {
    throw new Error(`Headline doesn't fit in two lines: ${text}`);
  }
  if (fit.lines < 2) {
    throw new Error(`Headline must set in two lines, not one: ${text}`);
  }
};

const settle = async (page: Page) => {
  await page.$$eval("img", (images) =>
    Promise.all((images as HTMLImageElement[]).map((image) => image.decode()))
  );
  await page.evaluate(() => document.fonts.ready);
};

const launch = () => {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath =
    process.env.CHROME_PATH ?? (existsSync(chrome) ? chrome : undefined);
  return chromium.launch({ headless: true, executablePath });
};

const requested = process.argv.slice(2) as StoreId[];
const stores = requested.length
  ? requested
  : (Object.keys(STORES) as StoreId[]);
for (const id of stores) {
  if (!(id in STORES)) {
    throw new Error(`Unknown store: ${id}`);
  }
}

const readJSON = (file: string) =>
  JSON.parse(readFileSync(path.join(root, file), "utf8"));
const native = readJSON("apps/apple/store/store.config.json").screenshots;
const configured: Partial<Record<StoreId, string[]>> = {
  "apple-iphone": native.iphone,
  "apple-ipad": native.ipad,
  "apple-mac": native.mac,
};
for (const id of stores) {
  const listed = configured[id];
  const names = STORES[id].shots.map(({ name }) => `${name}.png`);
  if (listed && listed.join() !== names.join()) {
    throw new Error(
      `The ${id} store config lists ${listed.join(", ")}, but shots.ts renders ${names.join(", ")}.`
    );
  }
}

const wallpaper = dataURI(
  path.join(import.meta.dir, "wallpaper.jpg"),
  "image/jpeg"
);
const framed = new Map<StoreId, Map<string, string>>();
for (const id of stores) {
  if (STORES[id].frame) {
    framed.set(id, await frameCaptures(id));
  }
}
const captures = new Map(
  stores.map((id) => [
    id,
    STORES[id].shots.map(({ name, headline, source, overlay }) => {
      const capture = (file: string) =>
        dataURI(path.join(root, STORES[id].sourceDir, `${file}.png`));
      return {
        name,
        headline,
        image: framed.get(id)?.get(name) ?? capture(source ?? name),
        overlay: overlay ? capture(overlay) : undefined,
      };
    }),
  ])
);

const browser = await launch();
try {
  for (const id of stores) {
    const store = STORES[id];
    const page = await browser.newPage({
      viewport: store.viewport,
      deviceScaleFactor: store.scale,
    });
    const outputDir = path.join(root, store.outputDir);
    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });
    for (const shot of captures.get(id) ?? []) {
      await page.setContent(
        `<style>${base(store.viewport.width, store.viewport.height, wallpaper)}</style>${pageFor[store.layout](shot.headline, shot.image, shot.overlay)}`
      );
      await settle(page);
      await page.$$eval("img.panel", (panels) => {
        for (const panel of panels as HTMLImageElement[]) {
          panel.style.width = `${panel.naturalWidth / 2}px`;
        }
      });
      await trimImages(page);
      await fitHeadline(page, shot.headline);
      await page.screenshot({ path: path.join(outputDir, `${shot.name}.png`) });
      console.log(
        `Rendered ${path.relative(root, outputDir)}/${shot.name}.png`
      );
    }
    await page.close();
  }

  if (stores.includes("android")) {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 500 },
    });
    const capture = dataURI(
      path.join(
        root,
        STORES.android.sourceDir,
        `${FEATURE_GRAPHIC.capture}.png`
      )
    );
    const logo = dataURI(
      path.join(root, "apps/docs/public/favicon.svg"),
      "image/svg+xml"
    );
    await page.setContent(`
      <style>${base(1024, 500, wallpaper)}
        .scrim { position: absolute; z-index: 1; inset: 0;
          background: linear-gradient(90deg, rgba(246,248,240,.94) 0, rgba(246,248,240,.82) 46%, rgba(246,248,240,0) 70%); }
        .copy { position: absolute; z-index: 2; left: 72px; top: 0; bottom: 0; width: 520px;
          display: flex; flex-direction: column; justify-content: center; }
        .copy img { width: 84px; height: 84px; margin-bottom: 26px; }
        h2 { margin: 0; font-size: 54px; line-height: 1.04; letter-spacing: -0.02em; font-weight: 700;
          text-wrap: balance; }
        p { margin: 18px 0 0; font-size: 24px; letter-spacing: -0.01em; opacity: .8; }
        .shot { top: 56px; right: 92px; width: 262px; padding: 7px; background: #1d1f1c;
          border-radius: 40px; transform: rotate(4deg);
          box-shadow: inset 0 0 0 1.5px #4a4d48, 0 22px 44px rgba(25,40,28,.32); }
        .shot img { width: 100%; display: block; border-radius: 33px; }
      </style>
      <div class="scrim"></div>
      <div class="copy"><img src="${logo}">${headline(FEATURE_GRAPHIC.headline, 520, "h2")}<p>${escapeHtml(FEATURE_GRAPHIC.subtitle)}</p></div>
      <div class="shot"><img src="${capture}"></div>`);
    await settle(page);
    await fitHeadline(page, FEATURE_GRAPHIC.headline, "h2");
    await page.screenshot({ path: path.join(root, FEATURE_GRAPHIC.output) });
    console.log(`Rendered ${FEATURE_GRAPHIC.output}`);
    await page.close();
  }
} finally {
  await browser.close();
}

const apple: Partial<Record<StoreId, string>> = {
  "apple-iphone": "APP_IPHONE_67",
  "apple-ipad": "APP_IPAD_PRO_3GEN_129",
  "apple-mac": "APP_DESKTOP",
};
for (const id of stores) {
  const deviceType = apple[id];
  if (deviceType) {
    await run([
      "asc",
      "screenshots",
      "validate",
      "--path",
      path.join(root, STORES[id].outputDir),
      "--device-type",
      deviceType,
      "--output",
      "json",
    ]);
    console.log(`asc validated ${id} (${deviceType}).`);
  }
}
