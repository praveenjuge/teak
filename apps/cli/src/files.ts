import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  inferFileFormat,
  isGenericMimeType,
  MAX_FILE_SIZE,
  mimeTypeForFileName,
} from "@teak/convex/shared/fileFormats";
import {
  isMarkdownFileName,
  MARKDOWN_CONTENT_MAX_BYTES,
  MARKDOWN_CONTENT_TOO_LARGE_MESSAGE,
} from "@teak/convex/shared/markdown";
import { InvalidArgumentError } from "commander";
import { type CardType, parseTags } from "teak-sdk";
import { type ClientOptions, client } from "./runtime";

const MAX_STDIN_BYTES = 1024 * 1024;

export const readStdin = async () => {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_STDIN_BYTES) {
      throw new InvalidArgumentError("stdin input must be at most 1MB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const mimeFor = (filePath: string) =>
  mimeTypeForFileName(path.basename(filePath));

export const getUploadFileInfo = (candidate: string) => {
  if (!(existsSync(candidate) && statSync(candidate).isFile())) {
    return null;
  }
  const stats = statSync(candidate);
  if (stats.size > MAX_FILE_SIZE) {
    throw new InvalidArgumentError(
      `file must be at most ${MAX_FILE_SIZE} bytes`
    );
  }
  const fileName = path.basename(candidate);
  if (isMarkdownFileName(fileName) && stats.size > MARKDOWN_CONTENT_MAX_BYTES) {
    throw new InvalidArgumentError(MARKDOWN_CONTENT_TOO_LARGE_MESSAGE);
  }
  const inferredMimeType = mimeFor(candidate);
  const format = inferFileFormat({ fileName, mimeType: inferredMimeType });
  if (!format) {
    throw new InvalidArgumentError("unsupported file type");
  }
  return {
    fileName,
    fileSize: stats.size,
    format,
    mimeType: isGenericMimeType(inferredMimeType)
      ? format.mimeType
      : inferredMimeType,
  };
};

/**
 * Stdin is read only when nothing else names the card, so `teak add --url`
 * inside a `while read` loop leaves the loop's input alone. Only a file named
 * on the command line is uploaded: piped text is always text, even when it
 * happens to be a path.
 */
export const resolveAddInput = async (
  input: string | undefined,
  explicitFile: string | undefined,
  explicitUrl?: string
) => {
  if (input || explicitFile || explicitUrl) {
    return { candidate: explicitFile || input || "", raw: input || "" };
  }
  return { candidate: "", raw: await readStdin() };
};

const isBareUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

export const addCard = async (
  input: string | undefined,
  options: ClientOptions & {
    file?: string;
    notes?: string;
    sourceTitle?: string;
    sourceUrl?: string;
    tags?: string;
    type?: string;
    url?: string;
  }
) => {
  const api = client(options);
  const requestOptions = { idempotencyKey: `teak-cli-${randomUUID()}` };
  const cardType = options.type as CardType | undefined;
  const tags = parseTags(options.tags);
  const { candidate, raw } = await resolveAddInput(
    input,
    options.file,
    options.url
  );
  const uploadFile = candidate ? getUploadFileInfo(candidate) : null;
  if (candidate && uploadFile) {
    if (options.sourceUrl || options.sourceTitle) {
      throw new InvalidArgumentError(
        "--source-url and --source-title are for text and links, not files"
      );
    }
    const { fileName, fileSize, mimeType } = uploadFile;
    const upload = await api.uploads.create({
      fileName,
      fileSize,
      mimeType,
    });
    const uploaded = await api.uploads.putFile(
      upload.uploadUrl,
      readFileSync(candidate),
      mimeType
    );
    return api.cards.create(
      {
        cardType,
        fileKey: upload.fileKey,
        fileEtag: uploaded.fileEtag,
        fileName,
        fileSize,
        mimeType,
        notes: options.notes,
        source: "cli",
        tags,
      },
      requestOptions
    );
  }
  const urlArgument = !options.url && isBareUrl(raw);
  const url = options.url || (urlArgument ? raw.trim() : undefined);
  const content = urlArgument ? undefined : raw || undefined;
  if (!(content || url)) {
    throw new InvalidArgumentError(
      "provide text, a URL, a file path, --url, --file, or stdin"
    );
  }
  return api.cards.create(
    {
      cardType,
      content,
      notes: options.notes,
      source: "cli",
      sourceTitle: options.sourceTitle,
      sourceUrl: options.sourceUrl,
      tags,
      url,
    },
    requestOptions
  );
};
