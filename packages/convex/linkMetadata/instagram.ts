import { sanitizeUrl } from "./parsing";

export const INSTAGRAM_HOSTNAME = "instagram.com";
export const INSTAGRAM_PRIMARY_IMAGE_MIN_DIM = 400;
export const INSTAGRAM_MEDIA_MIN_DIM = 200;
export const INSTAGRAM_PRIMARY_IMAGE_WAIT_MS = 3000;
const INSTAGRAM_POST_PATH_REGEX = /^\/(p|reel)\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i;

export type InstagramPostMedia = {
  contentType?: string;
  height?: number;
  posterContentType?: string;
  posterHeight?: number;
  posterUrl?: string;
  posterWidth?: number;
  type: "image" | "video";
  url: string;
  width?: number;
};

export const isInstagramHostname = (hostname: string): boolean =>
  hostname === INSTAGRAM_HOSTNAME ||
  hostname.endsWith(`.${INSTAGRAM_HOSTNAME}`);

export const isInstagramUrl = (url: string): boolean => {
  try {
    return isInstagramHostname(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const extractInstagramPostCode = (url: string): string | undefined => {
  try {
    const parsedUrl = new URL(url);
    if (!isInstagramHostname(parsedUrl.hostname)) {
      return undefined;
    }

    return parsedUrl.pathname.match(INSTAGRAM_POST_PATH_REGEX)?.[2];
  } catch {
    return undefined;
  }
};

export const isInstagramPostUrl = (url: string): boolean =>
  Boolean(extractInstagramPostCode(url));

const sanitizeDimension = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;

const sanitizeContentType = (
  value: unknown,
  expectedPrefix: "image/" | "video/"
): string | undefined =>
  typeof value === "string" && value.toLowerCase().startsWith(expectedPrefix)
    ? value.split(";")[0]?.trim() || value
    : undefined;

const inferMediaType = (
  candidate: Record<string, unknown>
): "image" | "video" | undefined => {
  if (candidate.type === "image" || candidate.type === "video") {
    return candidate.type;
  }

  const contentType =
    typeof candidate.contentType === "string"
      ? candidate.contentType.toLowerCase()
      : "";

  const url =
    typeof candidate.url === "string" ? candidate.url.toLowerCase() : "";

  if (
    contentType.startsWith("video/") ||
    /\.(mp4|mov|m4v)(?:[?#]|$)/i.test(url)
  ) {
    return "video";
  }

  if (
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url)
  ) {
    return "image";
  }

  return undefined;
};

export const normalizeInstagramExtractedMedia = (
  normalizedUrl: string,
  media: unknown
): InstagramPostMedia[] | undefined => {
  if (!Array.isArray(media)) {
    return undefined;
  }

  const normalized: InstagramPostMedia[] = [];
  const seen = new Set<string>();

  for (const item of media) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const type = inferMediaType(candidate);
    if (!type) {
      continue;
    }

    const url = sanitizeUrl(normalizedUrl, String(candidate.url ?? ""));
    if (!url) {
      continue;
    }

    const dedupeKey = `${type}:${url}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const width = sanitizeDimension(candidate.width);
    const height = sanitizeDimension(candidate.height);

    if (type === "image") {
      normalized.push({
        type,
        url,
        contentType: sanitizeContentType(candidate.contentType, "image/"),
        width,
        height,
      });
      continue;
    }

    const posterUrl = sanitizeUrl(
      normalizedUrl,
      typeof candidate.posterUrl === "string" ? candidate.posterUrl : undefined
    );

    normalized.push({
      type,
      url,
      contentType: sanitizeContentType(candidate.contentType, "video/"),
      width,
      height,
      posterUrl,
      posterContentType:
        sanitizeContentType(candidate.posterContentType, "image/") ??
        (posterUrl ? "image/jpeg" : undefined),
      posterWidth: sanitizeDimension(candidate.posterWidth),
      posterHeight: sanitizeDimension(candidate.posterHeight),
    });
  }

  return normalized.length ? normalized : undefined;
};

export const INSTAGRAM_PRIMARY_IMAGE_EVALUATOR = `
() => {
  const MIN_DIM = ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM};
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const candidates = Array.from(root.querySelectorAll("img"))
    .map(img => {
      const src = img.currentSrc || img.src;
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      const rect = img.getBoundingClientRect();
      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
      );
      const visibleArea = visibleWidth * visibleHeight;
      return {
        src,
        width,
        height,
        area: width * height,
        rectTop: rect.top,
        visibleArea,
      };
    })
    .filter(img =>
      img.src &&
      (img.src.startsWith("http://") || img.src.startsWith("https://")) &&
      img.width >= MIN_DIM &&
      img.height >= MIN_DIM &&
      img.area > 0
    )
    .sort((a, b) => b.visibleArea - a.visibleArea || b.area - a.area);

  const visibleCandidates = candidates.filter(candidate => candidate.visibleArea > 0);
  const topFoldCandidates = candidates.filter(
    candidate => candidate.rectTop >= 0 && candidate.rectTop < viewportHeight * 1.5
  );

  const chosen =
    visibleCandidates[0] ??
    topFoldCandidates[0] ??
    candidates[0];

  if (!chosen) {
    return null;
  }

  return { url: chosen.src, width: chosen.width, height: chosen.height };
}
`;

export const INSTAGRAM_MEDIA_EVALUATOR = `
() => {
  const MIN_DIM = ${INSTAGRAM_MEDIA_MIN_DIM};
  const POST_PATH = window.location.pathname.replace(/\\/+$/, "") || window.location.pathname;
  const root = document.querySelector("article");
  const seen = new Set();
  const media = [];

  const toAbsoluteUrl = (value) => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const resolved = new URL(trimmed, window.location.href);
      return /^https?:$/i.test(resolved.protocol) ? resolved.toString() : null;
    } catch {
      return null;
    }
  };

  const sanitizeNumber = (value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : undefined;

  const normalizePath = (value) => {
    try {
      return new URL(value, window.location.href).pathname.replace(/\\/+$/, "");
    } catch {
      return "";
    }
  };

  const isPostScopedUrl = (value) => {
    const normalized = toAbsoluteUrl(value);
    if (!normalized) {
      return false;
    }
    return normalizePath(normalized) === POST_PATH;
  };

  const getRelayPostCandidates = (item) => {
    const candidates = [];

    if (typeof item?.url === "string") {
      candidates.push(item.url);
    }

    if (typeof item?.code === "string" && item.code.trim()) {
      const code = item.code.trim();
      candidates.push("/p/" + code + "/");
      candidates.push("/reel/" + code + "/");
    }

    return candidates;
  };

  const pickLargestCandidate = (candidates) => {
    if (!Array.isArray(candidates)) {
      return null;
    }

    const normalized = candidates
      .map((candidate) => {
        const url = toAbsoluteUrl(candidate?.url);
        const width = sanitizeNumber(candidate?.width) || 0;
        const height = sanitizeNumber(candidate?.height) || 0;
        return {
          url,
          width,
          height,
          area: width * height,
        };
      })
      .filter((candidate) => candidate.url)
      .sort((left, right) => right.area - left.area);

    return normalized[0] || null;
  };

  const pushMedia = (item) => {
    const url = toAbsoluteUrl(item?.url);
    if (!url) {
      return;
    }

    const type =
      item?.type === "video" || item?.contentType?.startsWith?.("video/")
        ? "video"
        : "image";
    const key = type + ":" + url;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    media.push({
      type,
      url,
      contentType: typeof item?.contentType === "string" ? item.contentType : undefined,
      width: sanitizeNumber(item?.width),
      height: sanitizeNumber(item?.height),
      posterUrl: toAbsoluteUrl(item?.posterUrl),
      posterContentType:
        typeof item?.posterContentType === "string"
          ? item.posterContentType
          : undefined,
      posterWidth: sanitizeNumber(item?.posterWidth),
      posterHeight: sanitizeNumber(item?.posterHeight),
    });
  };

  const addRelayMediaItem = (item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    if (Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
      for (const carouselItem of item.carousel_media) {
        addRelayMediaItem(carouselItem);
      }
      return;
    }

    const imageCandidate = pickLargestCandidate(item.image_versions2?.candidates);
    const videoVersion = Array.isArray(item.video_versions)
      ? item.video_versions
          .map((variant) => ({
            url: toAbsoluteUrl(variant?.url),
            width: sanitizeNumber(variant?.width) || 0,
            height: sanitizeNumber(variant?.height) || 0,
            type:
              typeof variant?.type === "number"
                ? variant.type
                : undefined,
          }))
          .filter((variant) => variant.url)
          .sort((left, right) => {
            const leftArea = left.width * left.height;
            const rightArea = right.width * right.height;
            return rightArea - leftArea;
          })[0]
      : null;

    if (videoVersion?.url) {
      pushMedia({
        type: "video",
        url: videoVersion.url,
        contentType: "video/mp4",
        width: videoVersion.width || imageCandidate?.width,
        height: videoVersion.height || imageCandidate?.height,
        posterUrl: imageCandidate?.url || undefined,
        posterContentType: imageCandidate?.url ? "image/jpeg" : undefined,
        posterWidth: imageCandidate?.width,
        posterHeight: imageCandidate?.height,
      });
      return;
    }

    if (imageCandidate?.url) {
      pushMedia({
        type: "image",
        url: imageCandidate.url,
        contentType: "image/jpeg",
        width: imageCandidate.width,
        height: imageCandidate.height,
      });
    }
  };

  const findRelayPostItem = (node) => {
    if (!node || typeof node !== "object") {
      return null;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findRelayPostItem(item);
        if (found) {
          return found;
        }
      }
      return null;
    }

    if (
      node.xdt_api__v1__media__shortcode__web_info?.items?.[0] &&
      getRelayPostCandidates(
        node.xdt_api__v1__media__shortcode__web_info.items[0]
      ).some((candidate) => isPostScopedUrl(candidate))
    ) {
      return node.xdt_api__v1__media__shortcode__web_info.items[0];
    }

    for (const value of Object.values(node)) {
      const found = findRelayPostItem(value);
      if (found) {
        return found;
      }
    }

    return null;
  };

  const addRelayMedia = () => {
    for (const script of Array.from(document.querySelectorAll('script[type="application/json"]'))) {
      const text = script.textContent?.trim();
      if (!text || !text.includes("xdt_api__v1__media__shortcode__web_info")) {
        continue;
      }

      try {
        const parsed = JSON.parse(text);
        const postItem = findRelayPostItem(parsed);
        if (!postItem) {
          continue;
        }

        addRelayMediaItem(postItem);
        if (media.length > 0) {
          return;
        }
      } catch {}
    }
  };

  const addDomFallbackMedia = () => {
    if (!root) {
      return;
    }

    const candidates = [];

    for (const image of Array.from(root.querySelectorAll("img"))) {
      const url = toAbsoluteUrl(image.currentSrc || image.src);
      if (!url) {
        continue;
      }

      const width =
        image.naturalWidth ||
        sanitizeNumber(Number(image.getAttribute("width"))) ||
        sanitizeNumber(image.getBoundingClientRect().width);
      const height =
        image.naturalHeight ||
        sanitizeNumber(Number(image.getAttribute("height"))) ||
        sanitizeNumber(image.getBoundingClientRect().height);
      const alt = (image.getAttribute("alt") || "").toLowerCase();
      const container = image.closest("header, footer, nav, aside");
      const rect = image.getBoundingClientRect();

      if (
        !((width && width >= MIN_DIM) || (height && height >= MIN_DIM)) ||
        alt.includes("profile picture") ||
        container ||
        /\\.(gif)(?:[?#]|$)/i.test(url)
      ) {
        continue;
      }

      candidates.push({
        type: "image",
        url,
        contentType: "image/jpeg",
        width,
        height,
        score: Math.max(width, rect.width || 0) * Math.max(height, rect.height || 0),
      });
    }

    for (const video of Array.from(root.querySelectorAll("video"))) {
      const source =
        video.currentSrc ||
        video.src ||
        video.querySelector("source")?.src ||
        null;
      const url = toAbsoluteUrl(source);
      if (!url) {
        continue;
      }

      const width =
        video.videoWidth ||
        sanitizeNumber(Number(video.getAttribute("width"))) ||
        sanitizeNumber(video.getBoundingClientRect().width);
      const height =
        video.videoHeight ||
        sanitizeNumber(Number(video.getAttribute("height"))) ||
        sanitizeNumber(video.getBoundingClientRect().height);
      const rect = video.getBoundingClientRect();

      candidates.push({
        type: "video",
        url,
        contentType: "video/mp4",
        width,
        height,
        posterUrl: video.poster || undefined,
        posterContentType: video.poster ? "image/jpeg" : undefined,
        posterWidth: width,
        posterHeight: height,
        score: Math.max(width, rect.width || 0) * Math.max(height, rect.height || 0),
      });
    }

    const bestCandidate = candidates.sort((left, right) => right.score - left.score)[0];
    if (bestCandidate) {
      pushMedia(bestCandidate);
    }
  };

  addRelayMedia();
  if (media.length === 0) {
    addDomFallbackMedia();
  }

  const primaryImage =
    media.find((item) => item.type === "image") ||
    media.find((item) => item.type === "video" && item.posterUrl);

  return {
    media,
    primaryImage:
      primaryImage?.type === "image"
        ? {
            url: primaryImage.url,
            width: primaryImage.width,
            height: primaryImage.height,
          }
        : primaryImage?.posterUrl
          ? {
              url: primaryImage.posterUrl,
              width: primaryImage.posterWidth,
              height: primaryImage.posterHeight,
            }
          : null,
  };
}
`;

export const buildInstagramPrimaryImageSnippet = (): string => `
      try {
        const hostname = new URL(page.url()).hostname;
        const pathname = new URL(page.url()).pathname;
        const isInstagram = hostname === "${INSTAGRAM_HOSTNAME}" || hostname.endsWith(".${INSTAGRAM_HOSTNAME}");
        const isInstagramPost = /^\\/(p|reel)\\//i.test(pathname);
        if (isInstagram && isInstagramPost) {
          try {
            await page.waitForFunction(() => {
              return Array.from(document.querySelectorAll("article img, article video, main img, main video")).some(element => {
                if (element instanceof HTMLImageElement) {
                  return (
                    element.naturalWidth >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM} ||
                    element.naturalHeight >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM}
                  );
                }
                if (element instanceof HTMLVideoElement) {
                  return Boolean(element.currentSrc || element.src || element.poster);
                }
                return false;
              });
            }, { timeout: ${INSTAGRAM_PRIMARY_IMAGE_WAIT_MS} });
          } catch {}

          const instagramExtraction = await page.evaluate(${INSTAGRAM_MEDIA_EVALUATOR});
          if (instagramExtraction?.primaryImage) {
            primaryImage = instagramExtraction.primaryImage;
          }
          if (Array.isArray(instagramExtraction?.media) && instagramExtraction.media.length > 0) {
            instagramMedia = instagramExtraction.media;
          } else {
            try {
              await page.waitForFunction(() => {
                return Array.from(document.images).some(img =>
                  img.naturalWidth >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM} &&
                  img.naturalHeight >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM}
                );
              }, { timeout: ${INSTAGRAM_PRIMARY_IMAGE_WAIT_MS} });
            } catch {}

            primaryImage = primaryImage || await page.evaluate(${INSTAGRAM_PRIMARY_IMAGE_EVALUATOR});
          }
        } else if (isInstagram) {
          try {
            await page.waitForFunction(() => {
              return Array.from(document.images).some(img =>
                img.naturalWidth >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM} &&
                img.naturalHeight >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM}
              );
            }, { timeout: ${INSTAGRAM_PRIMARY_IMAGE_WAIT_MS} });
          } catch {}

          primaryImage = await page.evaluate(${INSTAGRAM_PRIMARY_IMAGE_EVALUATOR});
        }
      } catch {}
    `;
