import path from "node:path";

export const CACHE = path.join(import.meta.dir, ".cache");
/** Web shots capture at this size, at 2x. */
export const VIEWPORT = { width: 1180, height: 738 };

/** What render.ts needs beside a capture's PNG: numbered markers, relative to it. */
export interface CaptureMeta {
  markers?: { n: number; x: number; y: number }[];
}

export const captureFile = (name: string) => path.join(CACHE, `${name}.png`);

/** The browser both scripts use: DOCS_ASSETS_BROWSER, a cloud session's Chromium, or Playwright's own. */
export const browserPath = () =>
  process.env.DOCS_ASSETS_BROWSER ?? process.env.TEAK_CLOUD_CHROMIUM;
