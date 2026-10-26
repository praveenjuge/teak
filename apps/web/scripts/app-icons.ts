// Draws the installed web app's icons from src/app/icon.svg into public/icons.
// Run after the logo changes: bun --no-env-file run apps/web/scripts/app-icons.ts
// `any` icons keep the logo large; `maskable` ones keep it inside the 80% safe
// zone, since Android crops them to a circle or squircle.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const web = new URL("../", import.meta.url);
const logo = new URL("src/app/icon.svg", web);
const out = new URL("public/icons/", web);

const icons = [
  { name: "icon-192.png", size: 192, logoShare: 0.78 },
  { name: "icon-512.png", size: 512, logoShare: 0.78 },
  { name: "maskable-192.png", size: 192, logoShare: 0.6 },
  { name: "maskable-512.png", size: 512, logoShare: 0.6 },
];

await mkdir(out, { recursive: true });
for (const { name, size, logoShare } of icons) {
  const logoSize = Math.round(size * logoShare);
  const art = await sharp(logo.pathname, { density: 600 })
    .resize(logoSize, logoSize)
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#ffffff" },
  })
    .composite([{ input: art, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(new URL(name, out).pathname);
  console.log(`Wrote public/icons/${name}`);
}
