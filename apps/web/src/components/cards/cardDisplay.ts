import { inferFileFormat } from "@teak/convex/shared/file-formats";
import { hexToRgb } from "@teak/convex/shared/utils/colorUtils";
import { getSafeUrlHostname } from "@teak/convex/shared/utils/safeUrl";

export const CARD_SURFACE =
  "rounded-2xl border border-border/80 bg-card transition-[border-color,box-shadow] duration-200 group-hover/card:border-foreground/15 group-hover/card:shadow-[0_12px_32px_-16px_rgb(0_0_0/0.3)]";

export function getDisplayHostname(url?: string): string | undefined {
  return getSafeUrlHostname(url)?.replace(/^www\./, "") || undefined;
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
  if (breakAt === -1) {
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
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = (whole % 60).toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${mins.toString().padStart(2, "0")}:${secs}`
    : `${mins}:${secs}`;
}

export function isCardProcessing(card: {
  processingStatus?: Partial<Record<string, { status: string } | undefined>>;
}): boolean {
  return Object.values(card.processingStatus ?? {}).some(
    (stage) => stage?.status === "pending" || stage?.status === "in_progress"
  );
}
