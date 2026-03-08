import type { ExtractedPost } from "../../../types/social";
import { canonicalizeOutboundUrl } from "./shared";

const HEY_DESIGNER_POST_SELECTOR = "main article > section > ul > li";

export const findHeyDesignerPosts = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(HEY_DESIGNER_POST_SELECTOR));

export const extractHeyDesignerPost = (
  postElement: HTMLElement
): ExtractedPost | null => {
  const permalinkAnchor = postElement.querySelector<HTMLAnchorElement>(
    ':scope > a[href^="http"]'
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
    platform: "heydesigner",
    permalink,
    postKey: `heydesigner:${permalink}`,
  };
};
