/**
 * `bookmarks.html` for the export ZIP: the Netscape bookmark format that
 * Chrome, Firefox and Safari import.
 *
 * Pure (no Convex imports) so it can be fuzz-tested. Only link cards with a
 * safe web URL are written. Links in no folder come first; then each folder
 * is an `<H3>` section, and a card in several folders appears in each.
 */

import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import type { SerializedCard } from "./serialize";

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text and attribute values alike. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);

/** Bookmark names are one line: whitespace runs, newlines included, become one space. */
const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

const seconds = (epochMs: number): number => Math.floor(epochMs / 1000);

interface BookmarkLink {
  addDate: number;
  lastModified: number;
  tags: string[];
  title: string;
  url: string;
}

const toLink = (card: SerializedCard): BookmarkLink | null => {
  if (card.type !== "link") {
    return null;
  }
  const url = sanitizeExternalUrl(card.url);
  if (!url) {
    return null;
  }
  const title =
    oneLine(card.metadataTitle ?? "") || oneLine(card.content) || url;
  return {
    url,
    title,
    tags: card.tags.map(oneLine).filter(Boolean),
    addDate: seconds(card.createdAt.epochMs),
    lastModified: seconds(card.updatedAt.epochMs),
  };
};

const linkLine = (link: BookmarkLink, indent: string): string => {
  const tags = link.tags.length
    ? ` TAGS="${escapeHtml(link.tags.join(","))}"`
    : "";
  return `${indent}<DT><A HREF="${escapeHtml(link.url)}" ADD_DATE="${link.addDate}" LAST_MODIFIED="${link.lastModified}"${tags}>${escapeHtml(link.title)}</A>`;
};

/**
 * Builds the bookmarks file from serialized cards, keeping their order
 * within each section. Folders are sorted by name, as in the sidebar.
 */
export function buildBookmarksHtml(cards: readonly SerializedCard[]): string {
  const unfiled: BookmarkLink[] = [];
  const byFolder = new Map<string, BookmarkLink[]>();
  for (const card of cards) {
    const link = toLink(card);
    if (!link) {
      continue;
    }
    const folders = [...new Set(card.folders.map(oneLine).filter(Boolean))];
    if (folders.length === 0) {
      unfiled.push(link);
      continue;
    }
    for (const folder of folders) {
      const links = byFolder.get(folder);
      if (links) {
        links.push(link);
      } else {
        byFolder.set(folder, [link]);
      }
    }
  }

  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file.",
    "     It will be read and overwritten.",
    "     DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  ];
  for (const link of unfiled) {
    lines.push(linkLine(link, "    "));
  }
  const folderNames = [...byFolder.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  for (const name of folderNames) {
    lines.push(`    <DT><H3>${escapeHtml(name)}</H3>`, "    <DL><p>");
    for (const link of byFolder.get(name) ?? []) {
      lines.push(linkLine(link, "        "));
    }
    lines.push("    </DL><p>");
  }
  lines.push("</DL><p>", "");
  return lines.join("\n");
}
