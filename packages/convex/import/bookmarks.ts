import { Parser } from "htmlparser2";
import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import { cleanTags, folderPath, ImportLimitExceeded } from "./sourceItems";
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

export function parseBookmarksHtml(html: string): ParsedBookmarkItem[] {
  const output: ParsedBookmarkItem[] = [];
  const lists: BookmarkList[] = [];
  let foundList = false;
  let finishedList = false;
  let heading: string[] | undefined;
  // The browser's own toolbar and "Other bookmarks" folders, which hold
  // everything; they're the top level, not folders of the user's.
  let builtInHeading = false;
  let anchor:
    | { attributes: Record<string, string | undefined>; text: string[] }
    | undefined;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (finishedList) {
          return;
        }
        if (name === "dl") {
          // Exports leave <DT> and <p> open, so only folder lists count as
          // nesting.
          if (lists.length >= 128) {
            throw new Error("Bookmark HTML nesting exceeds its limit");
          }
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
          builtInHeading =
            attributes.personal_toolbar_folder === "true" ||
            attributes.unfiled_bookmarks_folder === "true";
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
        if (name === "h3" && heading) {
          const list = lists[lists.length - 1];
          if (list) {
            list.pendingFolder = builtInHeading
              ? undefined
              : heading.join("").trim();
          }
          heading = undefined;
        }
        if (name === "a" && anchor) {
          const title = anchor.text.join("").trim();
          const rawUrl = anchor.attributes.href;
          const url = sanitizeExternalUrl(rawUrl);
          const seconds = Number(anchor.attributes.add_date);
          const folder = folderPath(lists[lists.length - 1]?.folders ?? []);
          // Firefox and Teak write tags as a comma-separated TAGS attribute.
          const tags = cleanTags((anchor.attributes.tags ?? "").split(","));
          if (output.length >= 10_000) {
            throw new ImportLimitExceeded(
              "Bookmark file exceeds 10,000 bookmarks"
            );
          }
          output.push(
            url
              ? {
                  label: title || url,
                  card: {
                    type: "link",
                    content: title || url,
                    url,
                    tags,
                    folders: folder ? [folder] : undefined,
                    createdAt:
                      Number.isFinite(seconds) && seconds > 0
                        ? Math.floor(seconds * 1000)
                        : undefined,
                  },
                }
              : {
                  label: title || rawUrl || "Bookmark",
                  error:
                    "Bookmark URL is unsafe: only http and https links can be imported",
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
