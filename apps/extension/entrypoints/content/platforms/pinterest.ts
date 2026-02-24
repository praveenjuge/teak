import type { ExtractedPost } from "../../../types/social";

const PINTEREST_POST_SELECTOR =
  '[data-test-id="pin"], [data-test-id="pinWrapper"], [data-grid-item="true"]';
const PINTEREST_PATH = /^\/pin\/(\d+)/i;

const isPinterestHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return (
    normalized === "pinterest.com" || normalized.endsWith(".pinterest.com")
  );
};

const parsePermalink = (
  href: string
): { permalink: string; postKey: string } | null => {
  try {
    const parsed = new URL(href, window.location.origin);
    if (!isPinterestHost(parsed.hostname)) {
      return null;
    }

    const match = parsed.pathname.match(PINTEREST_PATH);
    if (!match?.[1]) {
      return null;
    }

    return {
      permalink: parsed.toString(),
      postKey: `pinterest:${match[1]}`,
    };
  } catch {
    return null;
  }
};

export const findPinterestPosts = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(PINTEREST_POST_SELECTOR));

export const extractPinterestPost = (
  postElement: HTMLElement
): ExtractedPost | null => {
  const anchors =
    postElement.querySelectorAll<HTMLAnchorElement>('a[href*="/pin/"]');

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
      platform: "pinterest",
      permalink: parsed.permalink,
      postKey: parsed.postKey,
    };
  }

  return null;
};
