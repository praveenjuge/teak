import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseTags } from "@teak/convex/sdk";
import {
  inferFileFormat,
  isGenericMimeType,
  MAX_FILE_SIZE,
  mimeTypeForFileName,
} from "@teak/convex/shared/file-formats";
import { InvalidArgumentError } from "commander";
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
  return Buffer.concat(chunks).toString("utf8").trim();
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

export const resolveAddInput = async (
  input: string | undefined,
  explicitFile: string | undefined
) => {
  const raw = input || (explicitFile ? "" : await readStdin());
  return { candidate: explicitFile || raw, raw };
};

export const addCard = async (
  input: string | undefined,
  options: ClientOptions & {
    file?: string;
    notes?: string;
    tags?: string;
    url?: string;
  }
) => {
  const api = client(options);
  const tags = parseTags(options.tags);
  const { candidate, raw } = await resolveAddInput(input, options.file);
  const uploadFile = candidate ? getUploadFileInfo(candidate) : null;
  if (candidate && uploadFile) {
    const { fileName, fileSize, mimeType } = uploadFile;
    const upload = await api.uploads.create({
      fileName,
      fileSize,
      mimeType,
    });
    await api.uploads.putFile(
      upload.uploadUrl,
      readFileSync(candidate),
      mimeType
    );
    return api.cards.create({
      fileKey: upload.fileKey,
      fileName,
      fileSize,
      mimeType,
      notes: options.notes,
      source: "cli",
      tags,
    });
  }
  const url = options.url || (/^https?:\/\//i.test(raw) ? raw : undefined);
  const content = url ? undefined : raw;
  if (!(content || url)) {
    throw new InvalidArgumentError(
      "provide text, a URL, a file path, --url, --file, or stdin"
    );
  }
  return api.cards.create({
    content,
    notes: options.notes,
    source: "cli",
    tags,
    url,
  });
};
