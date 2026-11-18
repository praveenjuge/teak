export type StoreId =
  | "android"
  | "apple-iphone"
  | "apple-ipad"
  | "apple-mac"
  | "raycast";

export interface Shot {
  /**
   * Short and catchy. render.ts sets every headline in exactly two balanced
   * lines, so write it as one sentence with no line break; wrap a phrase in
   * keep() when it mustn't split across the lines.
   */
  headline: string;
  name: string;
  overlay?: string;
  source?: string;
}

export interface Store {
  frame?: { device: string; size: [number, number] };
  layout: "mac" | "phone" | "tablet" | "android" | "raycast";
  outputDir: string;
  scale: number;
  shots: Shot[];
  simulator?: string;
  sourceDir: string;
  viewport: { width: number; height: number };
  window?: { app: string; title: string };
}

/** Joins words with no-break spaces so a headline never splits them. */
const keep = (words: string) => words.replaceAll(" ", "\u00a0");

const IPHONE_FRAME = {
  device: "iPhone 17 Pro Max - Silver - Portrait",
  size: [1520, 3100] as [number, number],
};

const PHONE_SHOTS: Shot[] = [
  { name: "01-library", headline: `Inspiration, ${keep("in your pocket.")}` },
  { name: "02-detail", headline: "Notes that remember why." },
  { name: "03-search", headline: `Find it ${keep("in seconds.")}` },
  { name: "04-palette", headline: `Colors, ${keep("one tap away.")}` },
  { name: "05-share", headline: "Save from any app." },
  { name: "06-add", headline: "Save anything, anywhere." },
];

const MAC_SHOTS: Shot[] = [
  { name: "01-library", headline: "Keep every spark." },
  { name: "02-detail", headline: "Notes that remember why." },
  { name: "03-search", headline: `Find it ${keep("in seconds.")}` },
  { name: "04-palette", headline: "Keep the colors you love." },
  {
    name: "05-capture",
    headline: "Capture without switching apps.",
    source: "01-library",
    overlay: "05-capture-panel",
  },
  { name: "06-safari", headline: "Save from Safari in a click." },
];

export const STORES: Record<StoreId, Store> = {
  "apple-iphone": {
    layout: "phone",
    frame: IPHONE_FRAME,
    simulator: "iPhone 17 Pro Max",
    sourceDir: "apps/apple/store/source/iphone",
    outputDir: "apps/apple/store/screenshots/iphone/en-US",
    viewport: { width: 440, height: 956 },
    scale: 3,
    shots: PHONE_SHOTS,
  },
  "apple-ipad": {
    layout: "tablet",
    frame: {
      device: "iPad Pro 13 - M4 - Silver - Portrait",
      size: [2400, 3100],
    },
    simulator: "iPad Pro 13-inch (M5)",
    sourceDir: "apps/apple/store/source/ipad",
    outputDir: "apps/apple/store/screenshots/ipad/en-US",
    viewport: { width: 1032, height: 1376 },
    scale: 2,
    shots: [
      {
        name: "01-library",
        headline: `Every spark, ${keep("on a bigger canvas.")}`,
      },
      { name: "02-detail", headline: "Notes that remember why." },
      { name: "03-search", headline: `Find it ${keep("in seconds.")}` },
      { name: "04-palette", headline: "Keep the colors you love." },
      { name: "05-add", headline: "Save anything, anywhere." },
    ],
  },
  "apple-mac": {
    layout: "mac",
    window: { app: "Teak", title: "Home" },
    sourceDir: "apps/apple/store/source/mac",
    outputDir: "apps/apple/store/screenshots/mac/en-US",
    viewport: { width: 1440, height: 900 },
    scale: 2,
    shots: MAC_SHOTS.filter(({ name }) => name !== "06-safari"),
  },
  android: {
    layout: "android",
    sourceDir: "apps/android/store/source",
    outputDir: "apps/android/store/listing/en-US/graphics/phone-screenshots",
    viewport: { width: 360, height: 640 },
    scale: 3,
    shots: [
      {
        name: "01-library",
        headline: `Inspiration, ${keep("in your pocket.")}`,
      },
      { name: "02-detail", headline: "Notes that remember why." },
      { name: "03-search", headline: `Find it ${keep("in seconds.")}` },
      { name: "04-palette", headline: `Colors, ${keep("one tap away.")}` },
      { name: "05-add", headline: "Save anything, anywhere." },
    ],
  },
  // Raycast's store wants up to six 2000 × 1250 PNGs in the extension's
  // metadata folder. The raw captures stay out of apps/raycast, which is
  // mirrored to the Raycast store as it is.
  raycast: {
    layout: "raycast",
    window: { app: "Raycast", title: "Main Window" },
    sourceDir: "scripts/store-assets/source/raycast",
    outputDir: "apps/raycast/metadata",
    viewport: { width: 1000, height: 625 },
    scale: 2,
    shots: [
      { name: "teak-raycast-1", headline: "Find any card in a keystroke." },
      { name: "teak-raycast-2", headline: "Every detail at a glance." },
      { name: "teak-raycast-3", headline: "Filter by tag, type or color." },
      {
        name: "teak-raycast-4",
        headline: "Save anything without switching apps.",
      },
      { name: "teak-raycast-5", headline: "See what's close in meaning." },
      {
        name: "teak-raycast-6",
        headline: `Narrow ${keep("it down")} by type.`,
      },
    ],
  },
};

export const FEATURE_GRAPHIC = {
  output: "apps/android/store/listing/en-US/graphics/feature_graphic.png",
  capture: "01-library",
  headline: "Save anything. Find it later.",
  subtitle: "Your inspiration library",
};
