import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type CardType, parseTags } from "@teak/convex/sdk";
import { InvalidArgumentError } from "commander";
import { type ClientOptions, client } from "./runtime";

const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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

export const mimeFor = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  return (
    (
      {
        ".aac": "audio/aac",
        ".gif": "image/gif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".m4a": "audio/mp4",
        ".mov": "video/quicktime",
        ".mp3": "audio/mpeg",
        ".mp4": "video/mp4",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".txt": "text/plain",
        ".wav": "audio/wav",
        ".webp": "image/webp",
      } as Record<string, string>
    )[ext] || "application/octet-stream"
  );
};

export const typeForMime = (mimeType: string): CardType => {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  return "document";
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
  if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
    const stats = statSync(candidate);
    if (stats.size > MAX_FILE_SIZE) {
      throw new InvalidArgumentError(
        `file must be at most ${MAX_FILE_SIZE} bytes`
      );
    }
    const mimeType = mimeFor(candidate);
    const upload = await api.uploads.create({
      fileName: path.basename(candidate),
      fileSize: stats.size,
      mimeType,
    });
    await api.uploads.putFile(
      upload.uploadUrl,
      readFileSync(candidate),
      mimeType
    );
    return api.cards.create({
      cardType: typeForMime(mimeType),
      fileKey: upload.fileKey,
      fileName: path.basename(candidate),
      fileSize: stats.size,
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
