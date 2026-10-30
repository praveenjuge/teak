import {
  arxivPdfUrl,
  isArxivPdfUrl,
  parseArxivId,
} from "@teak/convex/workflows/steps/categorization/remote/arxiv";
import {
  FILES_UPLOAD_MAX_BYTES,
  type FilesLinkedPdfParams,
  type FilesLinkedPdfResult,
} from "@teak/files-protocol";
import { isValidUploadKey } from "../storage/upload";

const ARXIV_HOSTS = new Set(["arxiv.org", "export.arxiv.org"]);
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";

export const parseLinkedPdfParams = (
  params: Record<string, unknown>
): FilesLinkedPdfParams => {
  const { destinationKey, url } = params;
  if (
    typeof url !== "string" ||
    !isArxivPdfUrl(url) ||
    typeof destinationKey !== "string" ||
    !isValidUploadKey(destinationKey)
  ) {
    throw new Error("invalid_linked_pdf_params");
  }
  return { destinationKey, url };
};

const isAllowedHop = (url: URL) =>
  url.protocol === "https:" && ARXIV_HOSTS.has(url.hostname.toLowerCase());

const fetchPdf = async (
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<Response | FilesLinkedPdfResult> => {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetcher(current.toString(), {
      headers: { accept: "application/pdf", "user-agent": USER_AGENT },
      redirect: "manual",
      signal,
    });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    await response.body?.cancel().catch(() => undefined);
    const location = response.headers.get("location");
    const next = location ? new URL(location, current) : null;
    if (!(next && isAllowedHop(next))) {
      return { reason: "fetch_failed", status: response.status, stored: false };
    }
    current = next;
  }
  return { reason: "fetch_failed", stored: false };
};

const { FixedLengthStream: FixedLength } = globalThis as {
  FixedLengthStream?: new (
    length: number
  ) => { readable: ReadableStream; writable: WritableStream };
};

// R2 needs a streamed body's length up front; FixedLengthStream also fails
// the put if arXiv sends more or fewer bytes than it declared.
const withLength = (body: ReadableStream, length: number): ReadableStream => {
  if (!FixedLength) {
    return body;
  }
  const { readable, writable } = new FixedLength(length);
  body.pipeTo(writable).catch(() => undefined);
  return readable;
};

export const storeLinkedPdf = async (
  env: { BUCKET: R2Bucket },
  params: FilesLinkedPdfParams,
  fetcher: typeof fetch = fetch
): Promise<FilesLinkedPdfResult> => {
  const existing = await env.BUCKET.head(params.destinationKey);
  if (existing) {
    return {
      contentType: existing.httpMetadata?.contentType ?? "application/pdf",
      reused: true,
      size: existing.size,
      stored: true,
    };
  }
  const id = parseArxivId(params.url);
  if (!id) {
    throw new Error("invalid_linked_pdf_params");
  }
  let response: Response | FilesLinkedPdfResult;
  try {
    response = await fetchPdf(
      arxivPdfUrl(id),
      fetcher,
      AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    );
  } catch {
    return { reason: "fetch_failed", stored: false };
  }
  if (!(response instanceof Response)) {
    return response;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { reason: "http_error", status: response.status, stored: false };
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/pdf") {
    await response.body?.cancel().catch(() => undefined);
    return { reason: "unsupported_type", stored: false };
  }
  const length = Number(response.headers.get("content-length"));
  if (!(response.body && Number.isSafeInteger(length) && length > 0)) {
    await response.body?.cancel().catch(() => undefined);
    return { reason: "fetch_failed", stored: false };
  }
  if (length > FILES_UPLOAD_MAX_BYTES) {
    await response.body.cancel().catch(() => undefined);
    return { reason: "too_large", stored: false };
  }
  try {
    await env.BUCKET.put(
      params.destinationKey,
      withLength(response.body, length),
      { httpMetadata: { contentType } }
    );
  } catch {
    return { reason: "fetch_failed", stored: false };
  }
  return { contentType, reused: false, size: length, stored: true };
};
