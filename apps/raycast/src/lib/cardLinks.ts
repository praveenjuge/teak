import type { RaycastCardLink } from "./apiParsers";
import { getTeakCardUrl } from "./constants";

const LINK_TOKEN = /\[\[([^\]|\n]{0,200})\|teak:([a-z0-9]{16,64})\]\]/g;
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/;

const escapeLinkText = (title: string): string =>
  title.replace(/[\\[\]]/g, "\\$&");

const replaceOutsideCode = (
  markdown: string,
  replace: (segment: string) => string,
): string =>
  markdown
    .split(CODE)
    .map((segment, index) => (index % 2 === 1 ? segment : replace(segment)))
    .join("");

const titleFor = (
  id: string,
  storedTitle: string,
  links: readonly RaycastCardLink[],
): string => {
  const linked = links.find((link) => link.id === id);
  if (linked?.missing) {
    return "Missing card";
  }
  return linked?.title?.trim() || storedTitle.trim() || "Card";
};

export const renderCardLinks = (
  markdown: string,
  links: readonly RaycastCardLink[] = [],
): string =>
  replaceOutsideCode(markdown, (segment) =>
    segment.replace(LINK_TOKEN, (_match, storedTitle: string, id: string) => {
      const title = titleFor(id, storedTitle, links);
      return links.find((link) => link.id === id)?.missing
        ? `_${title}_`
        : `[${escapeLinkText(title)}](${getTeakCardUrl(id)})`;
    }),
  );

export const cardLinksToText = (text: string): string =>
  text.replace(LINK_TOKEN, (_match, title: string) => title.trim() || "Card");

export const backlinksMarkdown = (
  backlinks: readonly RaycastCardLink[],
): string => {
  const visible = backlinks.filter((link) => !link.missing);
  return visible.length === 0
    ? ""
    : `## Linked from\n\n${visible
        .map(
          (link) =>
            `- [${escapeLinkText(link.title?.trim() || "Untitled card")}](${getTeakCardUrl(link.id)})`,
        )
        .join("\n")}`;
};
