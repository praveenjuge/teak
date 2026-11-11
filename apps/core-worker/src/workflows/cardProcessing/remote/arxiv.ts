import { formatDate } from "@teak/convex/shared/linkCategory/providers/common";
import { arxivPdfUrl, parseArxivId } from "@teak/convex/shared/utils/arxiv";
import { Parser } from "htmlparser2";
import {
  buildFacts,
  factValue,
  fetchRemoteText,
  formatAuthors,
  type RemoteDetails,
  type RemoteFetchDeps,
  summaryText,
} from "./common";

const VERSION_SUFFIX_REGEX = /v\d+$/;
const WITHDRAWN_REGEX = /\bwithdrawn\b/i;
/** A paper with 3,000 authors is about 250 KB of Atom. */
const ARXIV_MAX_BYTES = 1024 * 1024;

export const arxivApiUrl = (id: string) =>
  `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;

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
  if (deps.takeArxivSlot && !(await deps.takeArxivSlot())) {
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
