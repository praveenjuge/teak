import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { hexToRgb } from "@teak/convex/shared/utils/colorUtils";
import { formatClockTime } from "@/lib/clockTime";
import { startsWithTable } from "@/lib/markdownToPlainText";

/**
 * Keyboard focus and selection ring the whole card, the footer of a link or
 * document included. Selection wins while the card also has focus.
 */
const CARD_RINGS =
  "group-has-[[data-slot=card]:focus-visible]/card:ring-2 group-has-[[data-slot=card]:focus-visible]/card:ring-ring group-has-[[data-slot=card]:focus-visible]/card:ring-offset-2 group-has-[[data-slot=card]:focus-visible]/card:ring-offset-background group-data-[selected]/card:ring-2 group-data-[selected]/card:ring-primary! group-data-[selected]/card:ring-offset-2 group-data-[selected]/card:ring-offset-background";

/**
 * A row that sets --card-tile-height, such as the pinned row, gives every
 * tile and picture that one height; elsewhere it is unset and they keep
 * their shape.
 */
const ROW_HEIGHT = "h-(--card-tile-height)";

/** Every card that isn't a bare picture sits in this frame. */
export const CARD_FRAME = `relative w-full overflow-hidden rounded-xl border border-border/80 bg-card transition-colors duration-200 group-hover/card:border-foreground/20 ${CARD_RINGS}`;

/** Notes, quotes, palettes and audio: one 4:3 tile, words fit inside it. */
export const CARD_TILE = `${CARD_FRAME} aspect-[4/3] ${ROW_HEIGHT}`;

/**
 * The top of a link or document card, above its footer; 4:3 unless the
 * picture in it has a shape of its own.
 */
export const CARD_PREVIEW = `relative aspect-[4/3] w-full overflow-hidden ${ROW_HEIGHT}`;

/** Images and videos have no frame: the picture is the card. */
export const MEDIA_SURFACE = `relative w-full overflow-hidden ${ROW_HEIGHT} rounded-xl bg-muted outline-1 outline-black/5 -outline-offset-1 dark:outline-white/10 ${CARD_RINGS}`;

/** A video's play icon and length, bottom left, while the pointer is on it. */
export const CARD_BADGE =
  "pointer-events-none absolute bottom-2.5 left-2.5 flex h-[22px] max-w-[calc(100%-1.25rem)] items-center gap-1.5 truncate whitespace-nowrap rounded-full bg-gray-950/60 px-2 font-semibold text-[11.5px] text-white tabular-nums tracking-[0.01em] backdrop-blur-md";

/** One mark (favorite, done) in the bottom right corner of every card. */
export const CARD_MARK =
  "flex size-6 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10 [&_svg]:size-3";

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
