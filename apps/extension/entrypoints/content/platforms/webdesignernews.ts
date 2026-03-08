import type { ExtractedPost } from "../../../types/social";
import { canonicalizeOutboundUrl } from "./shared";

const WEB_DESIGNER_NEWS_POST_SELECTOR = ".posts_wrap > .single-post";

export const findWebDesignerNewsPosts = (root: ParentNode): HTMLElement[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>(WEB_DESIGNER_NEWS_POST_SELECTOR)
  );

export const extractWebDesignerNewsPost = (
  postElement: HTMLElement
): ExtractedPost | null => {
  const permalinkAnchor = postElement.querySelector<HTMLAnchorElement>(
    '.single-post-text h3 > a[href^="http"]'
  );
  const href = permalinkAnchor?.getAttribute("href");
  if (!href) {
    return null;
  }

  const permalink = canonicalizeOutboundUrl(href, {
    baseUrl: window.location.origin,
  });
  if (!permalink) {
    return null;
  }

  return {
    platform: "webdesignernews",
    permalink,
    postKey: `webdesignernews:${permalink}`,
  };
};
