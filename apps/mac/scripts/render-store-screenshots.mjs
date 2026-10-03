import { access, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const assets = new URL("../assets/screenshots/", import.meta.url);
const source = new URL("source/", assets);
const output = new URL("en-US/", assets);
const shots = [
  [
    "01-library",
    "Keep every spark of inspiration.",
    "Images, links, notes, and more. Together on your Mac.",
  ],
  [
    "02-detail",
    "Look closer. Keep what matters.",
    "Add a thought, edit a title, or save a favorite.",
  ],
  [
    "03-capture",
    "A thought worth keeping.",
    "Capture notes, quotes, files, and audio.",
  ],
  [
    "04-settings",
    "At home on your Mac.",
    "Your library and Safari, connected.",
  ],
  [
    "05-safari",
    "Save from Safari. Find it in Teak.",
    "Keep the good things you discover on the web.",
  ],
];
const imageURI = async (name) => {
  const file = new URL(`${name}.png`, source);
  try {
    return `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
  } catch (error) {
    throw new Error(`Missing screenshot source: ${fileURLToPath(file)}`, {
      cause: error,
    });
  }
};

// Load the complete set before opening a browser or changing release outputs.
const background = await imageURI("wallpaper-background");
const captures = await Promise.all(shots.map(([name]) => imageURI(name)));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let executablePath = process.env.MAC_SCREENSHOT_BROWSER;
if (!executablePath && process.platform === "darwin") {
  await access(chrome);
  executablePath = chrome;
}
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
  }, background);
  await mkdir(output, { recursive: true });
  for (const [index, [name, title, subtitle]] of shots.entries()) {
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; width: 1440px; height: 900px; overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; background: #e4eadc; }
        body::before { content: ''; position: absolute; inset: 0; background: url(${background}) center/cover; }
        body::after { content: ''; position: absolute; inset: 0; background: rgba(248,250,242,.16); }
        header { position: absolute; top: 24px; width: 100%; text-align: center; z-index: 1; color: #253529; }
        h1 { margin: 0; font-size: 34px; font-weight: 600; letter-spacing: -1px; }
        p { margin: 8px 0 0; font-size: 16px; color: #475249; }
        .app { position: absolute; z-index: 2; top: 110px; left: 160px; width: 1120px;
          height: 760px; display: flex; align-items: center; justify-content: center; }
        img { max-width: 100%; max-height: 100%; object-fit: contain;
          filter: drop-shadow(0 18px 30px rgba(25,40,28,.22)); border-radius: 14px; }
      </style>
      <header><h1>${title}</h1><p>${subtitle}</p></header>
      <div class="app"><img src="${captures[index]}" alt="Teak for Mac"></div>
    `);
    await page.locator("img").evaluate((image) => image.decode());
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: fileURLToPath(new URL(`${name}.png`, output)),
    });
    console.log(`Rendered ${name}.png (2880×1800)`);
  }
} finally {
  await browser.close();
}
