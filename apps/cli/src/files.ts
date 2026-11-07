import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
import { fetchWebUrl } from "@teak/convex/shared/utils/webUrl";
import { InvalidArgumentError } from "commander";
import { type CardType, parseTags, TeakApiError } from "teak-sdk";
import { plainOutput } from "./mode";
import {
  type ClientOptions,
  client,
  type GlobalOptions,
  write,
} from "./runtime";

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

// Reads a line at a terminal without echoing it. Ctrl+C stops the command.
const askHidden = (question: string) =>
  new Promise<string>((resolve) => {
    const input = process.stdin;
    let value = "";
    process.stderr.write(question);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          finish();
          process.kill(process.pid, "SIGINT");
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });

/**
 * `--api-key -`: the key from stdin, so it stays out of the shell's history
 * and other processes' view. At a terminal it asks without echoing.
 */
export const readApiKey = async (canAsk: boolean) => {
  let key: string;
  if (process.stdin.isTTY) {
    if (!canAsk) {
      throw new InvalidArgumentError(
        "--api-key - reads the key from stdin; pipe it in: teak --api-key - <command> < key.txt"
      );
    }
    key = await askHidden("Teak API key: ");
  } else {
    key = await readStdin();
  }
  const trimmed = key.trim();
  if (!trimmed) {
    throw new InvalidArgumentError("--api-key - read no key from stdin");
  }
  if (/\s/.test(trimmed)) {
    throw new InvalidArgumentError(
      "--api-key - reads only the key from stdin, on one line"
    );
  }
  return trimmed;
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
    return api.cards.createFromFile(
      {
        bytes: readFileSync(candidate),
        cardType,
        fileName: uploadFile.fileName,
        mimeType: uploadFile.mimeType,
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

// Checked before any download or export starts, so a rerun doesn't spend a
// weekly export on a file it then refuses to write.
export const refuseExisting = (target: string, force?: boolean) => {
  if (existsSync(target) && !force) {
    throw new InvalidArgumentError(
      `${target} already exists; pass --force to replace it`
    );
  }
};

/**
 * Where `-o` sends a file: a path, or `-` for stdout. Checked before any
 * request, so a mistake costs nothing.
 */
export const outputTarget = (
  output: string | undefined,
  options: GlobalOptions
) => {
  if (output === undefined) {
    return;
  }
  if (output.toLowerCase() === "json") {
    throw new InvalidArgumentError(
      "-o takes a path to save to; for JSON output add --json (or use -o ./json for a file named json)"
    );
  }
  if (output === "-") {
    if (options.json) {
      throw new InvalidArgumentError(
        "-o - writes the file to stdout, where --json would print too; use one"
      );
    }
    if (!plainOutput()) {
      throw new InvalidArgumentError(
        "-o - would print the file in the terminal; pipe it to a command, or pass -o <PATH>"
      );
    }
  }
  return output;
};

// The file appears whole or not at all: it's written beside the target and
// moved into place, so a failed or stopped download leaves no half a file.
// Without --force, linking refuses a file that appeared in the meantime.
export const writeNewFile = (
  target: string,
  bytes: Uint8Array,
  force?: boolean
) => {
  if (target === "-") {
    process.stdout.write(bytes);
    return;
  }
  refuseExisting(target, force);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.part`
  );
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    if (force) {
      renameSync(temporary, target);
      return;
    }
    try {
      linkSync(temporary, target);
    } catch (error) {
      // EEXIST: the file appeared meanwhile, and this refuses it. Anything
      // else is a file system without hard links: check, then move.
      refuseExisting(target, false);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw error;
      }
      renameSync(temporary, target);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
};

/** Says where the file went: stdout carries the file itself after -o -. */
export const writeSaved = (target: string, options: GlobalOptions) => {
  if (target === "-") {
    return;
  }
  write(options.json ? { path: target } : `Saved ${target}`, options);
};

export const fetchBytes = async (url: string) => {
  const response = await fetchWebUrl(
    url,
    undefined,
    () =>
      new TeakApiError(
        "REQUEST_FAILED",
        "Teak returned a download link that isn't a web address"
      )
  );
  if (!response.ok) {
    throw new TeakApiError(
      "REQUEST_FAILED",
      `Download failed with status ${response.status}`,
      { status: response.status }
    );
  }
  return new Uint8Array(await response.arrayBuffer());
};
