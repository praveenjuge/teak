import { Parser } from "htmlparser2";
import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import type { ImportCardInput } from "./validate";

export interface ParsedBookmarkItem {
  card?: ImportCardInput;
  error?: string;
  label: string;
}

interface BookmarkList {
  folders: string[];
  pendingFolder?: string;
}

/** Parse Netscape bookmark exports without constructing a DOM for the 20 MiB source. */
export function parseBookmarksHtml(html: string): ParsedBookmarkItem[] {
  const output: ParsedBookmarkItem[] = [];
  const lists: BookmarkList[] = [];
  let foundList = false;
  let finishedList = false;
  let depth = 0;
  let heading: string[] | undefined;
  let anchor:
    | { attributes: Record<string, string>; text: string[] }
    | undefined;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        depth += 1;
        if (depth > 128) {
          throw new Error("Bookmark HTML nesting exceeds its limit");
        }
        if (finishedList) {
          return;
        }
        if (name === "dl") {
          foundList = true;
          const parent = lists[lists.length - 1];
          const folders = parent?.pendingFolder
            ? [...parent.folders, parent.pendingFolder]
            : (parent?.folders ?? []);
          if (parent) {
            parent.pendingFolder = undefined;
          }
          lists.push({ folders });
        }
        if (!lists.length) {
          return;
        }
        if (name === "h3") {
          heading = [];
        }
        if (name === "a") {
          anchor = { attributes, text: [] };
        }
      },
      ontext(text) {
        heading?.push(text);
        anchor?.text.push(text);
      },
      onclosetag(name) {
        depth -= 1;
        if (name === "h3" && heading) {
          const list = lists[lists.length - 1];
          if (list) {
            list.pendingFolder = heading.join("").trim();
          }
          heading = undefined;
        }
        if (name === "a" && anchor) {
          const title = anchor.text.join("").trim();
          const rawUrl = anchor.attributes.href;
          const url = sanitizeExternalUrl(rawUrl);
          const seconds = Number(anchor.attributes.add_date);
          const folders = lists[lists.length - 1]?.folders ?? [];
          if (output.length >= 10_000) {
            throw new Error("Bookmark file exceeds 10,000 bookmarks");
          }
          output.push(
            url
              ? {
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
                }
              : {
                  label: title || rawUrl || "Bookmark",
                  error: "Bookmark URL is unsafe",
                }
          );
          anchor = undefined;
        }
        if (name === "dl" && lists.length) {
          lists.pop();
          if (!lists.length) {
            finishedList = true;
          }
        }
      },
    },
    { decodeEntities: true }
  );
  parser.end(html);
  if (!foundList) {
    throw new Error("Bookmarks HTML does not contain a bookmark list");
  }
  return output;
}
