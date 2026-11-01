import path from "node:path";

export const CACHE = path.join(import.meta.dir, ".cache");
export const VIEWPORT = { width: 1180, height: 738 };

export interface CaptureMeta {
  markers?: { n: number; x: number; y: number }[];
}

export const captureFile = (name: string) => path.join(CACHE, `${name}.png`);

export const browserPath = () => process.env.CHROME_PATH;
