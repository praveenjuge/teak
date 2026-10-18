import type { LinkCategoryDetail } from "@teak/convex/shared";
import type { ProviderEnrichmentResult, RawSelectorMap } from "./common";
import { formatDate, getRawAttribute } from "./common";

// A YouTube video's channel, length and upload date, from the schema.org
// microdata on its watch page.

const ISO_DURATION_REGEX =
  /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i;
const CHANNEL_MAX_LENGTH = 200;

/** `PT63M3S` as "1h 3m 3s"; YouTube counts minutes past 59. */
export const formatVideoLength = (
  value: string | undefined
): string | undefined => {
  const match = value ? ISO_DURATION_REGEX.exec(value) : null;
  if (!match) {
    return;
  }
  const [, days, hours, minutes, seconds] = match;
  const total = Math.floor(
    Number(days ?? 0) * 86_400 +
      Number(hours ?? 0) * 3600 +
      Number(minutes ?? 0) * 60 +
      Number(seconds ?? 0)
  );
  if (!(total > 0)) {
    return;
  }
  const parts: string[] = [];
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) {
    parts.push(`${h}h`);
  }
  if (m) {
    parts.push(`${m}m`);
  }
  if (s && !h) {
    parts.push(`${s}s`);
  }
  return parts.join(" ");
};

export const enrichYoutube = (
  rawMap: RawSelectorMap
): ProviderEnrichmentResult | null => {
  const channel = getRawAttribute(rawMap, "link[itemprop='name']", "content")
    ?.slice(0, CHANNEL_MAX_LENGTH)
    .trim();
  const durationRaw = getRawAttribute(
    rawMap,
    "meta[itemprop='duration']",
    "content"
  );
  const uploadDateRaw = getRawAttribute(
    rawMap,
    "meta[itemprop='uploadDate']",
    "content"
  );
  const length = formatVideoLength(durationRaw);
  const uploaded = formatDate(uploadDateRaw);

  const facts: LinkCategoryDetail[] = [];
  if (channel) {
    facts.push({ label: "Channel", value: channel });
  }
  if (length) {
    facts.push({ label: "Length", value: length });
  }
  if (uploaded) {
    facts.push({ label: "Uploaded", value: uploaded });
  }
  if (facts.length === 0) {
    return null;
  }
  return {
    facts,
    raw: {
      channel: channel ?? null,
      duration: durationRaw ?? null,
      uploadDate: uploadDateRaw ?? null,
    },
  };
};
