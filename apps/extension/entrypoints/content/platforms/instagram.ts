import type { ExtractedPost } from "../../../types/social";

const INSTAGRAM_POST_SELECTOR = "article";
const INSTAGRAM_PATH = /^\/(p|reel)\/([A-Za-z0-9_-]+)/i;

const isInstagramHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return (
    normalized === "instagram.com" || normalized.endsWith(".instagram.com")
  );
};

const parsePermalink = (
  href: string
): { permalink: string; postKey: string } | null => {
  try {
    const parsed = new URL(href, window.location.origin);
    if (!isInstagramHost(parsed.hostname)) {
      return null;
    }

    const match = parsed.pathname.match(INSTAGRAM_PATH);
    if (!match?.[2]) {
      return null;
    }

    return {
      permalink: parsed.toString(),
      postKey: `instagram:${match[2]}`,
    };
  } catch {
    return null;
  }
};

export const findInstagramPosts = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(INSTAGRAM_POST_SELECTOR));

export const extractInstagramPost = (
  postElement: HTMLElement
): ExtractedPost | null => {
  const anchors = postElement.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/p/"], a[href*="/reel/"]'
  );

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }

    const parsed = parsePermalink(href);
    if (!parsed) {
      continue;
    }

    return {
      platform: "instagram",
      permalink: parsed.permalink,
      postKey: parsed.postKey,
    };
  }

  return null;
};
