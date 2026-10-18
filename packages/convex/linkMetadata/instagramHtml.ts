import { Parser } from "htmlparser2";
import {
  extractInstagramPostCode,
  INSTAGRAM_MEDIA_MIN_DIM,
  type InstagramPostMedia,
  normalizeInstagramExtractedMedia,
} from "./instagram";

const RELAY_KEY = "xdt_api__v1__media__shortcode__web_info";
const MAX_SCRIPT_CHARS = 2 * 1024 * 1024;
const MAX_RELAY_SCRIPTS = 16;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
const MAX_CAROUSEL_ITEMS = 20;
const ALLOWED_MEDIA_HOST_SUFFIXES = ["cdninstagram.com", "fbcdn.net"];
const EXCLUDED_ANCESTORS = new Set(["header", "footer", "nav", "aside"]);

type RawMedia = Record<string, unknown>;

interface Sized {
  height: number;
  url: string;
  width: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toDimension = (value: unknown): number => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? Math.round(number)
    : 0;
};

const largestBySize = (values: unknown): Sized | undefined => {
  if (!Array.isArray(values)) {
    return undefined;
  }

  let best: (Sized & { area: number }) | undefined;
  for (const value of values) {
    if (!isRecord(value) || typeof value.url !== "string" || !value.url) {
      continue;
    }
    const width = toDimension(value.width);
    const height = toDimension(value.height);
    const area = width * height;
    if (!best || area > best.area) {
      best = { url: value.url, width, height, area };
    }
  }
  return best;
};

const relayItemToMedia = (
  item: Record<string, unknown>,
  output: RawMedia[],
  nested = false
): void => {
  if (Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
    if (nested) {
      return;
    }
    for (const child of item.carousel_media.slice(0, MAX_CAROUSEL_ITEMS)) {
      if (isRecord(child)) {
        relayItemToMedia(child, output, true);
      }
    }
    return;
  }

  const image = isRecord(item.image_versions2)
    ? largestBySize(item.image_versions2.candidates)
    : undefined;
  const video = largestBySize(item.video_versions);

  if (video) {
    output.push({
      type: "video",
      url: video.url,
      contentType: "video/mp4",
      width: video.width || image?.width,
      height: video.height || image?.height,
      posterUrl: image?.url,
      posterContentType: image ? "image/jpeg" : undefined,
      posterWidth: image?.width,
      posterHeight: image?.height,
    });
    return;
  }

  if (image) {
    output.push({
      type: "image",
      url: image.url,
      contentType: "image/jpeg",
      width: image.width,
      height: image.height,
    });
  }
};

const findRelayItem = (
  root: unknown,
  shortcode: string
): Record<string, unknown> | undefined => {
  const stack: { depth: number; node: unknown }[] = [{ node: root, depth: 0 }];
  let visited = 0;

  while (stack.length) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }
    const { node, depth } = entry;
    if (!node || typeof node !== "object") {
      continue;
    }
    visited += 1;
    if (visited > MAX_JSON_NODES) {
      return undefined;
    }

    if (isRecord(node)) {
      const info = node[RELAY_KEY];
      if (isRecord(info) && Array.isArray(info.items)) {
        const first = info.items[0];
        if (isRecord(first) && first.code === shortcode) {
          return first;
        }
      }
    }

    if (depth >= MAX_JSON_DEPTH) {
      continue;
    }
    const children = Array.isArray(node) ? node : Object.values(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: depth + 1 });
    }
  }
  return undefined;
};

const relayMediaFromScript = (
  text: string,
  shortcode: string
): RawMedia[] | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const item = findRelayItem(parsed, shortcode);
  if (!item) {
    return undefined;
  }
  const media: RawMedia[] = [];
  relayItemToMedia(item, media);
  return media.length ? media : undefined;
};

const isAllowedMediaUrl = (value: string | undefined): value is string => {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ALLOWED_MEDIA_HOST_SUFFIXES.some(
        (suffix) =>
          url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)
      )
    );
  } catch {
    return false;
  }
};

const resolveUrl = (pageUrl: string, value: string | undefined) => {
  if (!value?.trim()) {
    return;
  }
  try {
    return new URL(value.trim(), pageUrl).toString();
  } catch {}
};

const pickFromSrcset = (
  srcset: string | undefined
): { url: string; width: number } | undefined => {
  if (!srcset) {
    return undefined;
  }
  const tokens = srcset.split(/\s+/).filter(Boolean);
  const candidates: { url: string; width: number }[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    let url = tokens[index] ?? "";
    let width = 0;
    if (url.endsWith(",")) {
      url = url.slice(0, -1);
    } else {
      const descriptor = tokens[index + 1]?.replace(/,$/, "");
      if (descriptor && /^\d+(?:\.\d+)?[wx]$/.test(descriptor)) {
        index += 1;
        if (descriptor.endsWith("w")) {
          width = toDimension(descriptor.slice(0, -1));
        }
      }
    }
    if (url) {
      candidates.push({ url, width });
    }
  }
  return candidates.reduce<{ url: string; width: number } | undefined>(
    (best, candidate) =>
      !best || candidate.width >= best.width ? candidate : best,
    undefined
  );
};

interface DomCandidate {
  media: RawMedia;
  score: number;
}

const belowMinSize = (width: number, height: number) =>
  (width > 0 || height > 0) &&
  Math.max(width, 0) < INSTAGRAM_MEDIA_MIN_DIM &&
  Math.max(height, 0) < INSTAGRAM_MEDIA_MIN_DIM;

const imageCandidate = (
  pageUrl: string,
  attributes: Record<string, string>
): DomCandidate | undefined => {
  const fromSrcset = pickFromSrcset(attributes.srcset);
  const url = resolveUrl(pageUrl, fromSrcset?.url ?? attributes.src);
  if (
    !isAllowedMediaUrl(url) ||
    (attributes.alt ?? "").toLowerCase().includes("profile picture") ||
    /\.gif(?:[?#]|$)/i.test(url)
  ) {
    return undefined;
  }
  const width = toDimension(attributes.width) || fromSrcset?.width || 0;
  const height = toDimension(attributes.height);
  if (belowMinSize(width, height)) {
    return undefined;
  }
  return {
    media: {
      type: "image",
      url,
      contentType: "image/jpeg",
      width: width || undefined,
      height: height || undefined,
    },
    score: width * height,
  };
};

const videoCandidate = (
  pageUrl: string,
  attributes: Record<string, string>,
  sourceUrl: string | undefined
): DomCandidate | undefined => {
  const url = resolveUrl(pageUrl, attributes.src || sourceUrl);
  if (!isAllowedMediaUrl(url)) {
    return undefined;
  }
  const width = toDimension(attributes.width);
  const height = toDimension(attributes.height);
  const poster = resolveUrl(pageUrl, attributes.poster);
  return {
    media: {
      type: "video",
      url,
      contentType: "video/mp4",
      width: width || undefined,
      height: height || undefined,
      posterUrl: isAllowedMediaUrl(poster) ? poster : undefined,
      posterContentType: isAllowedMediaUrl(poster) ? "image/jpeg" : undefined,
      posterWidth: width || undefined,
      posterHeight: height || undefined,
    },
    score: width * height,
  };
};

/**
 * Instagram embeds relay JSON in script tags that can describe other posts:
 * only the item whose shortcode matches the URL is this post.
 */
export const extractInstagramMediaFromHtml = (
  pageUrl: string,
  html: string
): InstagramPostMedia[] | undefined => {
  const shortcode = extractInstagramPostCode(pageUrl);
  if (!shortcode) {
    return undefined;
  }

  const stack: string[] = [];
  let relayMedia: RawMedia[] | undefined;
  let relayScriptsTried = 0;
  let scriptChunks: string[] | undefined;
  let scriptChars = 0;
  let video:
    | { attributes: Record<string, string>; sourceUrl?: string }
    | undefined;
  let best: DomCandidate | undefined;

  const consider = (candidate: DomCandidate | undefined) => {
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  };
  const inPostContent = () =>
    stack.includes("article") && !stack.some((n) => EXCLUDED_ANCESTORS.has(n));

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        stack.push(name);
        if (name === "script" && !relayMedia) {
          scriptChunks = [];
          scriptChars = 0;
          return;
        }
        if (relayMedia || !inPostContent()) {
          return;
        }
        if (name === "img") {
          consider(imageCandidate(pageUrl, attributes));
        } else if (name === "video") {
          video = { attributes };
        } else if (name === "source" && video && !video.sourceUrl) {
          video.sourceUrl = attributes.src;
        }
      },
      ontext(text) {
        if (!scriptChunks) {
          return;
        }
        scriptChars += text.length;
        if (scriptChars > MAX_SCRIPT_CHARS) {
          scriptChunks = undefined;
          return;
        }
        scriptChunks.push(text);
      },
      onclosetag(name) {
        stack.pop();
        if (name === "script" && scriptChunks) {
          const text = scriptChunks.join("");
          scriptChunks = undefined;
          if (
            text.includes(RELAY_KEY) &&
            relayScriptsTried < MAX_RELAY_SCRIPTS
          ) {
            relayScriptsTried += 1;
            relayMedia = relayMediaFromScript(text, shortcode);
          }
        } else if (name === "script") {
          scriptChunks = undefined;
        } else if (name === "video" && video) {
          consider(videoCandidate(pageUrl, video.attributes, video.sourceUrl));
          video = undefined;
        }
      },
    },
    { decodeEntities: true }
  );
  parser.end(html);

  if (relayMedia) {
    return normalizeInstagramExtractedMedia(pageUrl, relayMedia);
  }
  const fallback = best as DomCandidate | undefined;
  return fallback
    ? normalizeInstagramExtractedMedia(pageUrl, [fallback.media])
    : undefined;
};
