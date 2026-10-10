/**
 * Every store image: which raw capture it uses and its headline. Order sets
 * the store order (file names carry a numeric prefix). To change a headline,
 * edit it here and re-render; to change what a screen shows, recapture it.
 */

export type StoreId = "mac" | "iphone" | "android";

export interface Shot {
  /** Short and catchy. One line on Mac, at most two on phones. */
  headline: string;
  /** Output and capture file name, without extension. */
  name: string;
  /** A second capture floated over the first, like a Mac panel. */
  overlay?: string;
  /** Capture to draw instead of `name`, when two shots share one. */
  source?: string;
}

export interface Store {
  /** Final images, in the layout each store's upload expects. */
  outputDir: string;
  scale: number;
  shots: Shot[];
  /** Raw captures, committed so headlines can change without recapturing. */
  sourceDir: string;
  /** CSS canvas size; output pixels are this times `scale`. */
  viewport: { width: number; height: number };
}

export const STORES: Record<StoreId, Store> = {
  mac: {
    sourceDir: "apps/mac/assets/screenshots/source",
    outputDir: "apps/mac/assets/screenshots/en-US",
    viewport: { width: 1440, height: 900 },
    scale: 2,
    shots: [
      { name: "01-library", headline: "Keep every spark." },
      { name: "02-detail", headline: "Notes that remember why." },
      { name: "03-search", headline: "Find it in seconds." },
      { name: "04-palette", headline: "Keep the colors you love." },
      {
        name: "05-capture",
        headline: "Capture without switching apps.",
        source: "01-library",
        overlay: "05-capture-panel",
      },
      { name: "06-safari", headline: "Save from Safari in a click." },
    ],
  },
  iphone: {
    sourceDir: "apps/mobile/store/apple/source",
    outputDir: "apps/mobile/store/apple/screenshot/en-US/APP_IPHONE_67",
    viewport: { width: 440, height: 956 },
    scale: 3,
    shots: [
      { name: "01-library", headline: "Inspiration,\nin your pocket." },
      { name: "02-detail", headline: "Notes that\nremember why." },
      { name: "03-search", headline: "Find it in seconds." },
      { name: "04-palette", headline: "Colors, one tap away." },
      { name: "05-share", headline: "Save from any app." },
      { name: "06-add", headline: "Save anything,\nanywhere." },
    ],
  },
  android: {
    sourceDir: "apps/android/store/source",
    outputDir: "apps/android/store/listing/en-US/graphics/phone-screenshots",
    viewport: { width: 360, height: 640 },
    scale: 3,
    shots: [
      { name: "01-library", headline: "Inspiration,\nin your pocket." },
      { name: "02-detail", headline: "Notes that\nremember why." },
      { name: "03-search", headline: "Find it in seconds." },
      { name: "04-palette", headline: "Colors, one tap away." },
      { name: "05-add", headline: "Save anything,\nanywhere." },
    ],
  },
};

/** Play's 1024 × 500 feature graphic, built from one Android capture. */
export const FEATURE_GRAPHIC = {
  output: "apps/android/store/listing/en-US/graphics/feature_graphic.png",
  capture: "01-library",
  headline: "Save anything.\nFind it later.",
  subtitle: "Your inspiration library",
};
