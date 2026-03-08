import type { ExtractedPost } from "../../../types/social";
import { canonicalizeOutboundUrl } from "./shared";

const SIDEBAR_POST_SELECTOR = ".post-content";

export const findSidebarPosts = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(SIDEBAR_POST_SELECTOR));

export const extractSidebarPost = (
  postElement: HTMLElement
): ExtractedPost | null => {
  const permalinkAnchors = postElement.querySelectorAll<HTMLAnchorElement>(
    'a.post-link[href*="/out?url="]'
  );

  for (const anchor of permalinkAnchors) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }

    const permalink = canonicalizeOutboundUrl(href, {
      baseUrl: window.location.origin,
      extraSearchParamsToStrip: ["ref"],
      redirectParam: "url",
    });
    if (!permalink) {
      continue;
    }

    return {
      platform: "sidebar",
      permalink,
      postKey: `sidebar:${permalink}`,
    };
  }

  return null;
};
