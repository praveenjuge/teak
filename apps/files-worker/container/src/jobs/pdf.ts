import { join } from "node:path";
import { pdfInfoCommand, pdfPageCommand, pdfTextCommand } from "../args";
import { toolFailure, unsupported } from "../errors";
import { run } from "../exec";
import type { JobResult } from "../manifest";
import type { PdfTextParams } from "../params";
import { type JobContext, readOutput } from "./context";

const PAGES_LINE = /^Pages:\s+(\d+)\s*$/m;
const PASSWORD = /password/i;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function parsePageCount(pdfinfo: string): number | null {
  const match = PAGES_LINE.exec(pdfinfo);
  return match ? Number(match[1]) : null;
}

export function pngSize(
  bytes: Uint8Array
): { width: number; height: number } | null {
  if (
    bytes.byteLength < 24 ||
    !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Trims and caps text at `maxChars` code points without splitting one. */
export function capText(
  text: string,
  maxChars: number
): { text: string; cut: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return { text: trimmed, cut: false };
  }
  let units = 0;
  let chars = 0;
  for (const char of trimmed) {
    if (chars === maxChars) {
      break;
    }
    units += char.length;
    chars++;
  }
  return {
    text: trimmed.slice(0, units).trimEnd(),
    cut: units < trimmed.length,
  };
}

async function pageCount(ctx: JobContext): Promise<number> {
  const result = await run(pdfInfoCommand(ctx.dir, ctx.input), {
    deadline: ctx.deadline,
  });
  if (result.exitCode !== 0) {
    if (!result.timedOut && PASSWORD.test(result.stderr)) {
      throw unsupported("The PDF is password protected");
    }
    throw toolFailure(result, "Could not read the PDF");
  }
  const pages = parsePageCount(new TextDecoder().decode(result.stdout));
  if (!pages) {
    throw unsupported("The PDF has no pages");
  }
  return pages;
}

export async function pdfPageJob(
  ctx: JobContext,
  params: { max: number }
): Promise<JobResult> {
  const pages = await pageCount(ctx);
  const prefix = join(ctx.dir, "page");
  const result = await run(
    pdfPageCommand(ctx.dir, ctx.input, params.max, prefix),
    { deadline: ctx.deadline }
  );
  const bytes =
    result.exitCode === 0 ? await readOutput(`${prefix}.png`) : null;
  const size = bytes ? pngSize(bytes) : null;
  if (!(bytes && size)) {
    throw toolFailure(result, "Could not render the PDF");
  }
  return {
    facts: null,
    parts: [{ name: "page", type: "image/png", bytes }],
    extra: { page: size, pages },
  };
}

export async function pdfTextJob(
  ctx: JobContext,
  params: PdfTextParams
): Promise<JobResult> {
  const pages = await pageCount(ctx);
  // UTF-8 needs at most four bytes a character, so this always holds
  // maxChars whole characters.
  const maxBytes = params.maxChars * 4 + 4;
  const result = await run(
    pdfTextCommand(ctx.dir, ctx.input, params.maxPages),
    {
      deadline: ctx.deadline,
      maxStdoutBytes: maxBytes,
      stopAtStdoutLimit: true,
    }
  );
  if (result.timedOut || !(result.exitCode === 0 || result.stdoutTruncated)) {
    throw toolFailure(result, "Could not extract the PDF text");
  }
  const { text, cut } = capText(
    new TextDecoder().decode(result.stdout),
    params.maxChars
  );
  const bytes = new TextEncoder().encode(text);
  return {
    facts: null,
    // A scan or image-only PDF has no text layer: no part rather than an
    // empty one, which the Worker would refuse.
    parts: bytes.byteLength
      ? [{ name: "text", type: "text/plain; charset=utf-8", bytes }]
      : [],
    extra: {
      pages,
      truncated: cut || result.stdoutTruncated || pages > params.maxPages,
    },
  };
}
