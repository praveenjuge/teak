import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { hexToRgb } from "@teak/convex/shared/utils/colorUtils";
import { formatClockTime } from "@/lib/clockTime";
import { startsWithTable } from "@/lib/markdownToPlainText";

const HOVER_LIFT =
  "transition-[border-color,box-shadow] duration-200 group-hover/card:shadow-[0_12px_32px_-16px_rgb(0_0_0/0.3)]";

/**
 * Keyboard focus and selection ring the tile, not the whole card, so a
 * link's name line under its tile stays outside the ring. Selection wins
 * while the card also has focus.
 */
const CARD_RINGS =
  "group-has-[[data-slot=card]:focus-visible]/card:ring-2 group-has-[[data-slot=card]:focus-visible]/card:ring-ring group-has-[[data-slot=card]:focus-visible]/card:ring-offset-2 group-has-[[data-slot=card]:focus-visible]/card:ring-offset-background group-data-[selected]/card:ring-2 group-data-[selected]/card:ring-primary! group-data-[selected]/card:ring-offset-2 group-data-[selected]/card:ring-offset-background";

export const CARD_SURFACE = `rounded-2xl border border-border/80 bg-card ${HOVER_LIFT} ${CARD_RINGS} group-hover/card:border-foreground/15`;

/**
 * Every card that isn't an image or a video is a tile of this one shape, so
 * the grid reads as rows of equal cards with media between them.
 */
export const CARD_TILE = `relative aspect-[4/3] w-full overflow-hidden ${CARD_SURFACE}`;

/** Images and videos have no frame: the picture is the card. */
export const MEDIA_SURFACE = `relative w-full overflow-hidden rounded-2xl bg-muted outline-1 outline-black/5 -outline-offset-1 dark:outline-white/10 ${HOVER_LIFT} ${CARD_RINGS}`;

/** Price, duration and file type all sit in this pill, bottom left. */
export const CARD_BADGE =
  "pointer-events-none absolute bottom-2.5 left-2.5 flex h-[22px] max-w-[calc(100%-1.25rem)] items-center gap-1.5 truncate whitespace-nowrap rounded-full bg-gray-950/60 px-2 font-semibold text-[11.5px] text-white tabular-nums tracking-[0.01em] backdrop-blur-md";

const MIN_MEDIA_RATIO = 3 / 4;
const MAX_MEDIA_RATIO = 16 / 9;

/**
 * An image or video keeps its own shape in the grid, between portrait 3:4
 * and widescreen 16:9, so a very tall or very wide one can't take over.
 */
export function mediaAspectRatio(
  width: number | undefined,
  height: number | undefined,
  fallback: number
): number {
  const ratio =
    width && height && width > 0 && height > 0 ? width / height : fallback;
  return Math.min(Math.max(ratio, MIN_MEDIA_RATIO), MAX_MEDIA_RATIO);
}

const SHORT_QUOTE = 40;
const MEDIUM_QUOTE = 95;

/** A quote's type shrinks as it grows, so every quote fills the same tile. */
export function quoteSizeClass(text: string): string {
  if (text.length < SHORT_QUOTE) {
    return "text-[23px]";
  }
  if (text.length < MEDIUM_QUOTE) {
    return "text-[19px]";
  }
  return "text-[15px]";
}

export function getFaviconUrl(hostname?: string): string | undefined {
  return hostname
    ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`
    : undefined;
}

export function getFileFormatBadge(
  fileName?: string,
  mimeType?: string
): string | undefined {
  if (!fileName) {
    return;
  }
  const format = inferFileFormat({ fileName, mimeType });
  const extension =
    format?.extension.split(".").pop() ??
    (fileName.includes(".") ? fileName.split(".").pop() : undefined);
  if (!extension || extension.length > 5) {
    return;
  }
  return extension.toUpperCase();
}

export function readableTextOn(hex: string): "black" | "white" {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return "black";
  }
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance > 0.179 ? "black" : "white";
}

const MAX_NOTE_PREVIEW_SOURCE = 4000;

export function splitNotePreview(content?: string | null): {
  body: string;
  heading?: string;
} {
  const source = (content ?? "").slice(0, MAX_NOTE_PREVIEW_SOURCE).trim();
  const breakAt = source.search(/\n\s*\n|\n/);
  if (breakAt === -1 || startsWithTable(source)) {
    return { body: source };
  }
  const heading = source.slice(0, breakAt).trim();
  const body = source.slice(breakAt).trim();
  return body ? { heading, body } : { body: heading };
}

export function formatDuration(seconds?: number): string | undefined {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return;
  }
  return formatClockTime(seconds);
}

/**
 * Whether the card is still being processed. A link's saved copy is quiet
 * background work that never holds a card up, so its stage doesn't count.
 */
export function isCardProcessing(card: {
  processingStatus?: Partial<Record<string, { status: string } | undefined>>;
}): boolean {
  return Object.entries(card.processingStatus ?? {}).some(
    ([stage, value]) =>
      stage !== "archive" &&
      (value?.status === "pending" || value?.status === "in_progress")
  );
}
