import type { ExtractedPost } from "../../../types/social";

const HACKER_NEWS_HOST = "news.ycombinator.com";
const HACKER_NEWS_POST_SELECTOR = "tr.athing > td.title:last-child";

const isExternalHttpUrl = (href: string): URL | null => {
  try {
    const parsed = new URL(href, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.hostname.toLowerCase() === HACKER_NEWS_HOST) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const findHackerNewsPosts = (root: ParentNode): HTMLElement[] =>
  window.location.pathname === "/item"
    ? []
    : Array.from(root.querySelectorAll<HTMLElement>(HACKER_NEWS_POST_SELECTOR));

export const extractHackerNewsPost = (
  postElement: HTMLElement
): ExtractedPost | null => {
  const row = postElement.closest("tr.athing");
  const storyId = row?.getAttribute("id");
  if (!(storyId && /^\d+$/u.test(storyId))) {
    return null;
  }

  const titleAnchor = postElement.querySelector<HTMLAnchorElement>(".titleline > a");
  const href = titleAnchor?.getAttribute("href");
  if (!href) {
    return null;
  }

  const parsed = isExternalHttpUrl(href);
  if (!parsed) {
    return null;
  }

  return {
    platform: "hackernews",
    permalink: parsed.toString(),
    postKey: `hackernews:${storyId}`,
  };
};
