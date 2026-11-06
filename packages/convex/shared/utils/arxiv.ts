const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org"]);
// 2301.01234 (4 or 5 digits after the dot) and hep-th/9901001, either with
// an optional version. Nothing else reaches the API's id_list.
const NEW_STYLE_ID_REGEX = /^\d{4}\.\d{4,5}(?:v\d{1,3})?$/;
const OLD_STYLE_ID_REGEX = /^[a-z-]{2,20}(?:\.[A-Z]{2})?\/\d{7}(?:v\d{1,3})?$/;
const ARXIV_PATH_REGEX = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i;

/** The paper id in an arXiv abstract or PDF link, or null. */
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

/** True only for the canonical PDF link of a paper, the one Save PDF stores. */
export const isArxivPdfUrl = (url: string): boolean => {
  const id = parseArxivId(url);
  return id !== null && url === arxivPdfUrl(id);
};
