import { DomUtils, parseDocument } from "htmlparser2";
import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import type { ImportCardInput } from "./validate";

export interface ParsedBookmarkItem {
  card?: ImportCardInput;
  error?: string;
  label: string;
}

function children(node: any): any[] {
  return Array.isArray(node?.children) ? node.children : [];
}

function elementName(node: any): string {
  return typeof node?.name === "string" ? node.name.toLowerCase() : "";
}

function attribute(node: any, name: string): string | undefined {
  const value = node?.attribs?.[name] ?? node?.attribs?.[name.toUpperCase()];
  return typeof value === "string" ? value : undefined;
}

function findFirst(node: any, name: string): any | undefined {
  if (elementName(node) === name) {
    return node;
  }
  for (const child of children(node)) {
    const found = findFirst(child, name);
    if (found) {
      return found;
    }
  }
}

function walkList(node: any, folders: string[], output: ParsedBookmarkItem[]) {
  const nodes = children(node).flatMap((child) =>
    elementName(child) === "p" ? children(child) : [child]
  );
  let pendingFolder: string | undefined;
  for (const child of nodes) {
    const name = elementName(child);
    if (name === "dt") {
      const heading = children(child).find(
        (value) => elementName(value) === "h3"
      );
      if (heading) {
        pendingFolder = DomUtils.textContent(heading).trim();
      }
      const anchor = children(child).find(
        (value) => elementName(value) === "a"
      );
      if (anchor) {
        const title = DomUtils.textContent(anchor).trim();
        const rawUrl = attribute(anchor, "href");
        const url = sanitizeExternalUrl(rawUrl);
        if (url) {
          const addDate = attribute(anchor, "add_date");
          const seconds = addDate ? Number(addDate) : Number.NaN;
          output.push({
            label: title || url,
            card: {
              type: "link",
              content: title || url,
              url,
              tags: folders.length ? [...folders] : undefined,
              createdAt:
                Number.isFinite(seconds) && seconds > 0
                  ? Math.floor(seconds * 1000)
                  : undefined,
            },
          });
        } else {
          output.push({
            label: title || rawUrl || "Bookmark",
            error: "Bookmark URL is unsafe",
          });
        }
      }
      const nested = children(child).find(
        (nestedChild) => elementName(nestedChild) === "dl"
      );
      if (nested) {
        walkList(
          nested,
          pendingFolder ? [...folders, pendingFolder] : folders,
          output
        );
        pendingFolder = undefined;
      }
      continue;
    }
    if (name === "dl") {
      walkList(
        child,
        pendingFolder ? [...folders, pendingFolder] : folders,
        output
      );
      pendingFolder = undefined;
    }
  }
}

export function parseBookmarksHtml(html: string): ParsedBookmarkItem[] {
  const document = parseDocument(html, { decodeEntities: true });
  const rootList = findFirst(document, "dl");
  if (!rootList) {
    throw new Error("Bookmarks HTML does not contain a bookmark list");
  }
  const output: ParsedBookmarkItem[] = [];
  walkList(rootList, [], output);
  return output;
}
