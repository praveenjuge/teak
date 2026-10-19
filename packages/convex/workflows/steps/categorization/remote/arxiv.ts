import { Parser } from "htmlparser2";
import { formatDate } from "../providers/common";
import {
  buildFacts,
  factValue,
  fetchRemoteText,
  formatAuthors,
  type RemoteDetails,
  type RemoteFetchDeps,
  summaryText,
} from "./common";

const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org"]);
// 2301.01234 (4 or 5 digits after the dot) and hep-th/9901001, either with
// an optional version. Nothing else reaches the API's id_list.
const NEW_STYLE_ID_REGEX = /^\d{4}\.\d{4,5}(?:v\d{1,3})?$/;
const OLD_STYLE_ID_REGEX = /^[a-z-]{2,20}(?:\.[A-Z]{2})?\/\d{7}(?:v\d{1,3})?$/;
const ARXIV_PATH_REGEX = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i;
const VERSION_SUFFIX_REGEX = /v\d+$/;
const WITHDRAWN_REGEX = /\bwithdrawn\b/i;
/** A paper with 3,000 authors is about 250 KB of Atom. */
const ARXIV_MAX_BYTES = 1024 * 1024;

export const parseArxivId = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!ARXIV_HOSTS.has(parsed.hostname.toLowerCase())) {
      return null;
    }
    const id = parsed.pathname.match(ARXIV_PATH_REGEX)?.[1];
    if (!id) {
      return null;
    }
    return NEW_STYLE_ID_REGEX.test(id) || OLD_STYLE_ID_REGEX.test(id)
      ? id
      : null;
  } catch {
    return null;
  }
};

export const arxivPdfUrl = (id: string) => `https://arxiv.org/pdf/${id}`;

export const arxivApiUrl = (id: string) =>
  `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;

export const isArxivPdfUrl = (url: string): boolean => {
  const id = parseArxivId(url);
  return id !== null && url === arxivPdfUrl(id);
};

export interface ArxivEntry {
  authors: string[];
  comment?: string;
  doi?: string;
  id?: string;
  primaryCategory?: string;
  published?: string;
  summary?: string;
  title?: string;
}

export const parseArxivAtom = (xml: string): ArxivEntry | null => {
  let entry: ArxivEntry | null = null;
  let inEntry = false;
  let done = false;
  const stack: string[] = [];
  let text = "";

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (done) {
          return;
        }
        if (name === "entry") {
          inEntry = true;
          entry = { authors: [] };
        } else if (inEntry && name === "arxiv:primary_category" && entry) {
          entry.primaryCategory = attributes.term;
        }
        stack.push(name);
        text = "";
      },
      ontext(chunk) {
        if (inEntry && !done) {
          text += chunk;
        }
      },
      onclosetag(name) {
        if (done) {
          return;
        }
        stack.pop();
        const current: ArxivEntry | null = entry;
        if (!(inEntry && current)) {
          return;
        }
        const value = text.trim();
        const parent = stack[stack.length - 1];
        if (name === "entry") {
          inEntry = false;
          done = true;
        } else if (name === "name" && parent === "author") {
          current.authors.push(value);
        } else if (parent === "entry") {
          if (name === "id") {
            current.id = value;
          } else if (name === "title") {
            current.title = value;
          } else if (name === "summary") {
            current.summary = value;
          } else if (name === "published") {
            current.published = value;
          } else if (name === "arxiv:doi") {
            current.doi = value;
          } else if (name === "arxiv:comment") {
            current.comment = value;
          }
        }
        text = "";
      },
    },
    { decodeEntities: true, xmlMode: true }
  );
  parser.write(xml);
  parser.end();
  return entry;
};

const isWithdrawn = (entry: ArxivEntry) =>
  WITHDRAWN_REGEX.test(entry.comment ?? "") ||
  (entry.summary ?? "")
    .trim()
    .toLowerCase()
    .startsWith("this paper has been withdrawn");

export const readArxivEntry = (
  id: string,
  entry: ArxivEntry
): RemoteDetails | null => {
  // An unknown id answers with an entry whose id is an error page.
  if (!entry.id || entry.id.includes("/api/errors") || !entry.title) {
    return null;
  }
  const details: RemoteDetails = {
    source: "arxiv",
    facts: buildFacts([
      ["Authors", factValue(formatAuthors(entry.authors))],
      ["Published", entry.published ? formatDate(entry.published) : undefined],
      ["Subject", factValue(entry.primaryCategory)],
      ["DOI", factValue(entry.doi)],
    ]),
    summary: summaryText(entry.summary),
  };
  // A withdrawn paper's PDF is only the withdrawal notice.
  if (!isWithdrawn(entry)) {
    details.pdfUrl = arxivPdfUrl(id.replace(VERSION_SUFFIX_REGEX, ""));
  }
  return details;
};

export const fetchArxivDetails = async (
  sourceUrl: string,
  deps: RemoteFetchDeps
): Promise<RemoteDetails | null> => {
  const id = parseArxivId(sourceUrl);
  if (!id) {
    return null;
  }
  if (deps.takeArxivSlot && !(await deps.takeArxivSlot().catch(() => false))) {
    return null;
  }
  const { text } = await fetchRemoteText(arxivApiUrl(id), deps, {
    accept: "application/atom+xml",
    maxBytes: ARXIV_MAX_BYTES,
  });
  if (!text) {
    return null;
  }
  try {
    const entry = parseArxivAtom(text);
    return entry ? readArxivEntry(id, entry) : null;
  } catch {
    return null;
  }
};
