import type { ExtractedPost } from "../../../types/social";

const X_POST_SELECTOR = 'article[data-testid="tweet"]';
const X_STATUS_PATH = /^\/[^/]+\/status\/(\d+)/i;

const isXHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return normalized === "x.com" || normalized.endsWith(".x.com");
};

const parsePermalink = (
  href: string
): { permalink: string; postKey: string } | null => {
  try {
    const parsed = new URL(href, window.location.origin);
    if (!isXHost(parsed.hostname)) {
      return null;
    }

    const match = parsed.pathname.match(X_STATUS_PATH);
    if (!match?.[1]) {
      return null;
    }

    return {
      permalink: parsed.toString(),
      postKey: `x:${match[1]}`,
    };
  } catch {
    return null;
  }
};

export const findXPosts = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(X_POST_SELECTOR));

export const extractXPost = (
  postElement: HTMLElement
): ExtractedPost | null => {
  const permalinkAnchors = postElement.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/status/"]'
  );

  for (const anchor of permalinkAnchors) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }

    const parsed = parsePermalink(href);
    if (!parsed) {
      continue;
    }

    return {
      platform: "x",
      permalink: parsed.permalink,
      postKey: parsed.postKey,
    };
  }

  return null;
};
