import {
  FILES_PDF_OCR_MAX_PAGES,
  FILES_UPLOAD_MAX_BYTES,
  type FilesPdfOcrResult,
  normalizeImageOcrText,
} from "@teak/files-protocol";
import { InspectSourceMissing } from "../archives/zip";
import {
  INVALID_IMAGE_OUTPUT,
  readImageText,
  toDataUrl,
} from "../images/imageMetadata";
import type { Env } from "../index";
import { renderPdfPageBytes } from "./mediaJobs";
import { RendererDeclined } from "./rendererClient";

const NOTHING_READ: FilesPdfOcrResult = {
  pageCount: null,
  pagesRead: 0,
  text: "",
};

const readPage = async (env: Env, png: Uint8Array): Promise<string> => {
  try {
    return await readImageText(
      env,
      toDataUrl(png, "image/png"),
      "teak.ai.ocr.pdf"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message === INVALID_IMAGE_OUTPUT ||
      message === "malformed_workers_ai_response"
    ) {
      return "";
    }
    throw error;
  }
};

export const ocrPdfPages = async (
  env: Env,
  sourceKey: string,
  maxPages: number
): Promise<FilesPdfOcrResult> => {
  const head = await env.BUCKET.head(sourceKey);
  if (!head) {
    throw new InspectSourceMissing();
  }
  if (head.size > FILES_UPLOAD_MAX_BYTES) {
    return NOTHING_READ;
  }
  const limit = Math.min(Math.max(1, maxPages), FILES_PDF_OCR_MAX_PAGES);
  const texts: string[] = [];
  let pageCount: number | null = null;
  let pagesRead = 0;
  for (let page = 1; page <= Math.min(limit, pageCount ?? 1); page++) {
    let rendered: Awaited<ReturnType<typeof renderPdfPageBytes>>;
    try {
      rendered = await renderPdfPageBytes(env, sourceKey, page);
    } catch (error) {
      if (error instanceof RendererDeclined) {
        break;
      }
      throw error;
    }
    pageCount = rendered.pageCount ?? page;
    const text = await readPage(env, rendered.png);
    pagesRead += 1;
    if (text) {
      texts.push(text);
    }
  }
  if (pagesRead === 0) {
    return NOTHING_READ;
  }
  return {
    pageCount,
    pagesRead,
    text: normalizeImageOcrText(texts.join("\n\n")) ?? "",
  };
};
