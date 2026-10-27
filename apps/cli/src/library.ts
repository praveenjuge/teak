import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { TAG_OPERATION_STALL_MS } from "@teak/convex/shared/tags";
import {
  THUMBNAIL_ERROR_MESSAGES,
  THUMBNAIL_MAX_BYTES,
  toThumbnailMimeType,
} from "@teak/convex/shared/thumbnails";
import { fetchWebUrl } from "@teak/convex/shared/utils/webUrl";
import { isSupportedLocale, LOCALE_NAMES } from "@teak/i18n/locales";
import { InvalidArgumentError } from "commander";
import {
  type CardContentKind,
  type CardsPage,
  type ExportJob,
  type Folder,
  type FolderColor,
  type Highlight,
  type LatestExport,
  type TagOperation,
  TeakApiError,
  type TeakClient,
} from "teak-sdk";
import { mimeFor } from "./files";
import { formatCardLinks } from "./format";
import {
  type ClientOptions,
  client,
  EXIT,
  exitCodeFor,
  type GlobalOptions,
  openBrowser,
  write,
} from "./runtime";

type PageFetcher = (cursor?: string) => Promise<CardsPage>;

const mergeSearchMode = (
  listing: CardsPage["searchMode"],
  page: CardsPage["searchMode"]
) => (page === "keyword" ? "keyword" : listing);

export const collectPages = async (
  fetchPage: PageFetcher,
  all: boolean
): Promise<CardsPage> => {
  const first = await fetchPage();
  if (!(all && first.pageInfo.nextCursor)) {
    return first;
  }
  const items = [...first.items];
  let cursor: string | null = first.pageInfo.nextCursor;
  let { searchMode } = first;
  while (cursor) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.pageInfo.nextCursor;
    searchMode = mergeSearchMode(searchMode, page.searchMode);
  }
  return {
    items,
    pageInfo: { hasMore: false, nextCursor: null },
    ...(searchMode ? { searchMode } : {}),
    ...(first.relevanceRanked === undefined
      ? {}
      : { relevanceRanked: first.relevanceRanked }),
    ...(first.similarity ? { similarity: first.similarity } : {}),
  };
};

const confirm = async (question: string) => {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await prompt.question(`${question} (y/N) `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
};

interface CardFailure {
  error: unknown;
  id: string;
}

const eachCard = async (
  ids: string[],
  run: (id: string) => Promise<unknown>
) => {
  const succeeded: string[] = [];
  const failed: CardFailure[] = [];
  for (const id of ids) {
    try {
      await run(id);
      succeeded.push(id);
    } catch (error) {
      failed.push({ error, id });
    }
  }
  return { failed, succeeded };
};

const failureMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const failureJson = ({ error, id }: CardFailure) => ({
  code: error instanceof TeakApiError ? error.code : "REQUEST_FAILED",
  id,
  message: failureMessage(error),
});

const writeBatch = (
  output: unknown,
  failed: CardFailure[],
  options: GlobalOptions
) => {
  if (options.json || output !== "") {
    write(output, options);
  }
  if (failed.length === 0) {
    return;
  }
  if (!options.json) {
    process.stderr.write(
      `${failed
        .map(({ error, id }) => `${id}: ${failureMessage(error)}`)
        .join("\n")}\n`
    );
  }
  process.exitCode = exitCodeFor(failed[0]?.error);
};

export const deleteCards = async (
  ids: string[],
  options: GlobalOptions & { permanent?: boolean; yes?: boolean }
) => {
  if (options.permanent && !options.yes) {
    if (!process.stdin.isTTY) {
      throw new InvalidArgumentError(
        "--permanent can't be undone; add --yes to confirm"
      );
    }
    const noun = ids.length === 1 ? "this card" : `these ${ids.length} cards`;
    if (!(await confirm(`Delete ${noun} forever? This can't be undone.`))) {
      write(options.json ? { deletedIds: [] } : "Nothing deleted.", options);
      return;
    }
  }
  const api = client(options);
  const deleteForever = async (id: string) => {
    try {
      await api.cards.delete(id, { permanent: true });
    } catch (error) {
      if (!(error instanceof TeakApiError && error.code === "NOT_IN_TRASH")) {
        throw error;
      }
      await api.cards.delete(id);
      await api.cards.delete(id, { permanent: true });
    }
  };
  const { failed, succeeded } = await eachCard(ids, (id) =>
    options.permanent ? deleteForever(id) : api.cards.delete(id)
  );
  const done = options.permanent
    ? (id: string) => `Deleted ${id} forever`
    : (id: string) => `Moved ${id} to Trash. Undo with: teak restore ${id}`;
  writeBatch(
    options.json
      ? {
          deletedIds: succeeded,
          ...(failed.length > 0 ? { failed: failed.map(failureJson) } : {}),
          permanent: Boolean(options.permanent),
        }
      : succeeded.map(done).join("\n"),
    failed,
    options
  );
};

export const restoreCards = async (ids: string[], options: GlobalOptions) => {
  const api = client(options);
  const { failed, succeeded } = await eachCard(ids, (id) =>
    api.cards.restore(id)
  );
  writeBatch(
    options.json
      ? {
          ...(failed.length > 0 ? { failed: failed.map(failureJson) } : {}),
          restoredIds: succeeded,
        }
      : succeeded.map((id) => `Restored ${id}`).join("\n"),
    failed,
    options
  );
};

export const setCardsArchived = async (
  ids: string[],
  isArchived: boolean,
  options: GlobalOptions
) => {
  const api = client(options);
  const { failed, succeeded } = await eachCard(ids, (id) =>
    api.cards.setArchived(id, isArchived)
  );
  writeBatch(
    options.json
      ? {
          ...(failed.length > 0 ? { failed: failed.map(failureJson) } : {}),
          [isArchived ? "archivedIds" : "unarchivedIds"]: succeeded,
        }
      : succeeded
          .map((id) =>
            isArchived ? `Archived ${id}` : `Returned ${id} to the library`
          )
          .join("\n"),
    failed,
    options
  );
};

export const setCardThumbnail = async (
  id: string,
  file: string | undefined,
  options: GlobalOptions & { reset?: boolean }
) => {
  const api = client(options);
  if (options.reset) {
    if (file) {
      throw new InvalidArgumentError("pass an image file or --reset, not both");
    }
    const card = await api.cards.resetThumbnail(id);
    write(options.json ? card : `${id} shows its original image`, options);
    return;
  }
  if (!file) {
    throw new InvalidArgumentError("pass an image file, or --reset");
  }
  if (!(existsSync(file) && statSync(file).isFile())) {
    throw new InvalidArgumentError(`no file at ${file}`);
  }
  const mimeType = toThumbnailMimeType(mimeFor(file));
  if (!mimeType) {
    throw new InvalidArgumentError(THUMBNAIL_ERROR_MESSAGES.unsupported);
  }
  if (statSync(file).size > THUMBNAIL_MAX_BYTES) {
    throw new InvalidArgumentError(THUMBNAIL_ERROR_MESSAGES.tooLarge);
  }
  const card = await api.cards.setThumbnail(id, readFileSync(file), mimeType);
  write(options.json ? card : `Replaced the image of ${id}`, options);
};

export const refreshCards = async (ids: string[], options: GlobalOptions) => {
  const api = client(options);
  const { failed, succeeded } = await eachCard(ids, (id) =>
    api.cards.refresh(id)
  );
  writeBatch(
    options.json
      ? {
          ...(failed.length > 0 ? { failed: failed.map(failureJson) } : {}),
          queuedIds: succeeded,
        }
      : succeeded
          .map((id) => `Refreshing ${id}. Check it with: teak cards get ${id}`)
          .join("\n"),
    failed,
    options
  );
};

export const findDuplicateCard = async (
  url: string,
  options: GlobalOptions
) => {
  const cardId = await client(options).cards.duplicate(url);
  if (!cardId) {
    throw new TeakApiError("NOT_FOUND", "No card saves this URL");
  }
  write(options.json ? { cardId } : cardId, options);
};

/** `--kind`: the kinds of text `cards content` can ask for. */
export const CONTENT_KINDS: readonly CardContentKind[] = [
  "article",
  "document",
  "transcript",
  "content",
];

export const showCardContent = async (
  id: string,
  options: GlobalOptions & { kind?: CardContentKind }
) => {
  const content = await client(options).cards.content(
    id,
    options.kind ? { kind: options.kind } : undefined
  );
  write(options.json ? content : content.text, options);
  if (options.json || !content.truncated) {
    return;
  }
  let note =
    "Teak keeps the first 500 pages and 524,288 characters of a document; this one is longer.\n";
  if (Array.from(content.text).length < content.charCount) {
    note =
      "Only the start of this document's text could be read; try again later for all of it.\n";
  } else if (content.kind === "article") {
    note =
      "Teak keeps the first 524,288 characters of an article; this one is longer.\n";
  }
  process.stderr.write(note);
};

export const showCardLinks = async (id: string, options: GlobalOptions) => {
  const links = await client(options).cards.links(id);
  write(options.json ? links : formatCardLinks(links), options);
};

export const openCard = async (id: string, options: GlobalOptions) => {
  const card = await client(options).cards.get(id);
  const opened = await openBrowser(card.appUrl);
  write(options.json ? { appUrl: card.appUrl, opened } : card.appUrl, options);
  if (!(opened || options.json)) {
    process.stderr.write(
      "Couldn't open a browser here. Open the link above to see the card.\n"
    );
  }
};

// Checked before any download or export starts, so a rerun doesn't spend a
// weekly export on a file it then refuses to write.
const refuseExisting = (target: string, force?: boolean) => {
  if (existsSync(target) && !force) {
    throw new InvalidArgumentError(
      `${target} already exists; pass --force to replace it`
    );
  }
};

const writeNewFile = (target: string, bytes: Uint8Array, force?: boolean) => {
  refuseExisting(target, force);
  writeFileSync(target, bytes);
};

const fetchBytes = async (url: string) => {
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

export const downloadCard = async (
  id: string,
  options: GlobalOptions & { force?: boolean; output?: string }
) => {
  const card = await client(options).cards.get(id);
  if (!card.fileUrl) {
    throw new InvalidArgumentError("This card has no file to download");
  }
  const target =
    options.output || path.basename(card.fileName || `${card.id}.bin`);
  refuseExisting(target, options.force);
  writeNewFile(target, await fetchBytes(card.fileUrl), options.force);
  write(options.json ? { path: target } : `Saved ${target}`, options);
};

const planLine = (me: Awaited<ReturnType<TeakClient["me"]>>) =>
  me.plan === "pro"
    ? `Pro plan · ${me.cardCount} cards`
    : `Free plan · ${me.cardCount} of ${me.cardLimit} cards`;

// The language in its own name; a code this CLI doesn't know prints as is.
const languageLine = (locale: string) =>
  `Language: ${isSupportedLocale(locale) ? LOCALE_NAMES[locale].native : locale}`;

export const whoami = async (options: GlobalOptions) => {
  const me = await client(options).me();
  const lines = [me.email, planLine(me)];
  if (me.locale) {
    lines.push(languageLine(me.locale));
  }
  write(options.json ? me : lines.join("\n"), options);
};

export const authStatus = async (options: GlobalOptions, source: string) => {
  const me = await client(options).me();
  write(
    options.json
      ? { source, status: "ok", email: me.email }
      : `Signed in as ${me.email} via ${source}.`,
    options
  );
};

export const editTags = async (
  id: string,
  names: string[],
  mode: "add" | "remove",
  options: GlobalOptions
) => {
  const api = client(options);
  const wanted = names.map((name) => name.trim().toLowerCase()).filter(Boolean);
  const card = await api.cards.get(id);
  const isWanted = (tag: string) => wanted.includes(tag.toLowerCase());
  const update =
    mode === "add"
      ? { tags: Array.from(new Set([...card.tags, ...wanted])) }
      : {
          tags: card.tags.filter((tag) => !isWanted(tag)),
          removeAiTags: card.aiTags.filter(isWanted),
        };
  if (mode === "remove" && update.removeAiTags?.length === 0) {
    update.removeAiTags = undefined;
  }
  const updated = await api.cards.update(id, update);
  write(
    options.json
      ? updated
      : [
          `tags: ${updated.tags.join(", ") || "(none)"}`,
          `ai tags: ${updated.aiTags.join(", ") || "(none)"}`,
        ].join("\n"),
    options
  );
};

const describeExport = (latest: LatestExport) => {
  const { job } = latest;
  if (!job) {
    return "No exports yet. Start one with: teak export";
  }
  const lines = [`Export ${job.id}: ${job.status}`];
  if (job.status === "pending" || job.status === "running") {
    lines.push(
      job.processedCount
        ? `${job.processedCount} cards processed${job.stage ? ` (${job.stage})` : ""}`
        : "Starting…"
    );
  }
  if (job.cardCount !== null) {
    lines.push(`${job.cardCount} cards, ${job.filesIncluded ?? 0} files`);
  }
  if (job.downloadUrl && job.expiresAt) {
    lines.push(
      `Ready until ${new Date(job.expiresAt).toLocaleString()}. Download with: teak export download`
    );
  }
  if (!latest.canStartNew && latest.nextAvailableAt) {
    lines.push(
      `Next export available ${new Date(latest.nextAvailableAt).toLocaleString()}`
    );
  }
  return lines.join("\n");
};

const isActive = (job: ExportJob | null) =>
  job?.status === "pending" || job?.status === "running";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const FIRST_POLL_MS = 250;
const MAX_POLL_MS = 3000;

const waitForExport = async (api: TeakClient, intervalMs?: number) => {
  let latest = await api.exports.latest();
  let delay = intervalMs ?? FIRST_POLL_MS;
  while (isActive(latest.job)) {
    if (process.stderr.isTTY && latest.job?.processedCount) {
      process.stderr.write(`\r${latest.job.processedCount} cards processed…`);
    }
    await sleep(delay);
    delay = intervalMs ?? Math.min(delay * 2, MAX_POLL_MS);
    latest = await api.exports.latest();
  }
  if (process.stderr.isTTY) {
    process.stderr.write("\r\x1b[K");
  }
  return latest;
};

export const exportStatus = async (options: GlobalOptions) => {
  const latest = await client(options).exports.latest();
  write(options.json ? latest : describeExport(latest), options);
};

export const downloadExport = async (
  options: GlobalOptions & { force?: boolean; output?: string }
) => {
  const { job } = await client(options).exports.latest();
  if (!job?.downloadUrl) {
    throw new InvalidArgumentError(
      "No export is ready to download. Check with: teak export status"
    );
  }
  const target =
    options.output ||
    `teak-export-${new Date(job.createdAt).toISOString().slice(0, 10)}.zip`;
  writeNewFile(target, await fetchBytes(job.downloadUrl), options.force);
  write(options.json ? { path: target } : `Saved ${target}`, options);
};

export const startExport = async (
  options: ClientOptions & {
    force?: boolean;
    intervalMs?: number;
    output?: string;
    wait?: boolean;
  }
) => {
  if (options.output) {
    refuseExisting(options.output, options.force);
  }
  const api = client(options);
  try {
    await api.exports.start();
  } catch (error) {
    if (!(error instanceof TeakApiError && error.code === "CONFLICT")) {
      if (error instanceof TeakApiError && error.code === "RATE_LIMITED") {
        const latest = await api.exports.latest();
        throw new TeakApiError(
          "RATE_LIMITED",
          `You can start one export every 7 days.\n${describeExport(latest)}`,
          { retryAt: error.retryAt, status: error.status }
        );
      }
      throw error;
    }
  }
  const latest =
    options.wait || options.output
      ? await waitForExport(api, options.intervalMs)
      : await api.exports.latest();
  if (options.output && latest.job?.downloadUrl) {
    await downloadExport(options);
    return;
  }
  write(options.json ? latest : describeExport(latest), options);
  // A wait that ends without an archive (failed, canceled, or ready with no
  // download for -o) isn't a backup.
  if (options.output || (options.wait && latest.job?.status !== "ready")) {
    process.exitCode = EXIT.api;
  }
};

export const resolveFolder = async (
  api: TeakClient,
  ref: string
): Promise<Folder> => {
  const wanted = ref.trim();
  const { items } = await api.folders.list();
  const match =
    items.find((folder) => folder.id === wanted) ??
    items.find((folder) => folder.name.toLowerCase() === wanted.toLowerCase());
  if (!match) {
    throw new TeakApiError("NOT_FOUND", `Folder not found: ${ref}`);
  }
  return match;
};

export const formatFolderLine = (folder: Folder) =>
  [
    folder.id,
    (folder.kind === "smart" ? "-" : String(folder.cardCount)).padStart(4),
    folder.color ? `${folder.name} (${folder.color})` : folder.name,
    ...(folder.kind === "smart" ? [`smart: ${folder.query ?? ""}`] : []),
  ].join("  ");

export const showFolder = async (ref: string, options: GlobalOptions) => {
  const api = client(options);
  const folder = await api.folders.get((await resolveFolder(api, ref)).id);
  write(options.json ? folder : formatFolderLine(folder), options);
};

export const listFolders = async (options: GlobalOptions) => {
  const result = await client(options).folders.list();
  write(
    options.json ? result : result.items.map(formatFolderLine).join("\n"),
    options
  );
};

export const createFolder = async (
  name: string,
  options: GlobalOptions & { color?: FolderColor; query?: string }
) => {
  const color = options.color ? { color: options.color } : {};
  const folder = await client(options).folders.create(
    options.query === undefined
      ? { name, ...color }
      : { name, ...color, kind: "smart", query: options.query }
  );
  write(options.json ? folder : formatFolderLine(folder), options);
};

export const updateFolder = async (
  ref: string,
  name: string | undefined,
  options: GlobalOptions & { color?: FolderColor | "none"; query?: string }
) => {
  if (
    name === undefined &&
    options.color === undefined &&
    options.query === undefined
  ) {
    throw new InvalidArgumentError("give a new name, --color or --query");
  }
  const api = client(options);
  const folder = await resolveFolder(api, ref);
  const updated = await api.folders.update(folder.id, {
    ...(name === undefined ? {} : { name }),
    ...(options.color === undefined
      ? {}
      : { color: options.color === "none" ? null : options.color }),
    ...(options.query === undefined ? {} : { query: options.query }),
  });
  write(options.json ? updated : formatFolderLine(updated), options);
};

export const deleteFolders = async (refs: string[], options: GlobalOptions) => {
  const api = client(options);
  const { failed, succeeded } = await eachCard(refs, async (ref) =>
    api.folders.delete((await resolveFolder(api, ref)).id)
  );
  writeBatch(
    options.json
      ? {
          ...(failed.length > 0 ? { failed: failed.map(failureJson) } : {}),
          deleted: succeeded,
        }
      : succeeded
          .map((ref) => `Deleted folder ${ref}; its cards are kept`)
          .join("\n"),
    failed,
    options
  );
};

export const changeFolderCards = async (
  ref: string,
  cardIds: string[],
  action: "add" | "remove",
  options: GlobalOptions
) => {
  const api = client(options);
  const folder = await resolveFolder(api, ref);
  const updatedIds: string[] = [];
  const failedIds: string[] = [];
  const folderLimitIds: string[] = [];
  for (let start = 0; start < cardIds.length; start += 100) {
    const chunk = cardIds.slice(start, start + 100);
    const result =
      action === "add"
        ? await api.folders.addCards(folder.id, chunk)
        : await api.folders.removeCards(folder.id, chunk);
    updatedIds.push(...result.updatedIds);
    failedIds.push(...result.failedIds);
    folderLimitIds.push(...result.folderLimitIds);
  }
  const verb = action === "add" ? "Added" : "Removed";
  write(
    options.json
      ? { folderId: folder.id, updatedIds, failedIds, folderLimitIds }
      : `${verb} ${updatedIds.length} ${updatedIds.length === 1 ? "card" : "cards"} ${action === "add" ? "to" : "from"} ${folder.name}`,
    options
  );
  if (failedIds.length > 0) {
    const limited = new Set(folderLimitIds);
    if (!options.json) {
      process.stderr.write(
        `${failedIds
          .map(
            (id) =>
              `${id}: ${limited.has(id) ? "already in the most folders a card can be in" : "not found"}`
          )
          .join("\n")}\n`
      );
    }
    process.exitCode = batchFolderExitCode(failedIds, limited);
  }
};

const batchFolderExitCode = (
  failedIds: string[],
  folderLimitIds: Set<string>
) => {
  const anyNotFound = failedIds.some((id) => !folderLimitIds.has(id));
  return exitCodeFor(
    new TeakApiError(anyNotFound ? "NOT_FOUND" : "FOLDER_LIMIT")
  );
};

const cardsLabel = (count: number) => `${count} card${count === 1 ? "" : "s"}`;

export const describeTagOperation = (operation: TagOperation) => {
  const to = operation.to ?? "";
  if (operation.status === "completed") {
    const done = {
      rename: `Renamed "${operation.from}" to "${to}"`,
      merge: `Merged "${operation.from}" into "${to}"`,
      delete: `Deleted "${operation.from}"`,
    }[operation.kind];
    return `${done} on ${cardsLabel(operation.changed)}.`;
  }
  if (operation.status === "failed") {
    const verb = { rename: "renaming", merge: "merging", delete: "deleting" }[
      operation.kind
    ];
    return `Couldn't finish ${verb} "${operation.from}". ${operation.changed} of ${cardsLabel(operation.total)} changed.`;
  }
  const doing = {
    rename: `Renaming "${operation.from}" to "${to}"`,
    merge: `Merging "${operation.from}" into "${to}"`,
    delete: `Deleting "${operation.from}"`,
  }[operation.kind];
  return `${doing}: ${operation.changed} of ${cardsLabel(operation.total)} changed so far. Check with: teak tags status ${operation.id}`;
};

const waitForTagOperation = async (
  api: TeakClient,
  started: TagOperation,
  intervalMs?: number
) => {
  let operation = started;
  let delay = intervalMs ?? FIRST_POLL_MS;
  while (operation.status === "running") {
    if (Date.now() - operation.updatedAt > TAG_OPERATION_STALL_MS) {
      operation = { ...operation, status: "failed" };
      break;
    }
    if (process.stderr.isTTY) {
      process.stderr.write(
        `\r${operation.changed} of ${cardsLabel(operation.total)} changed…`
      );
    }
    await sleep(delay);
    delay = intervalMs ?? Math.min(delay * 2, MAX_POLL_MS);
    operation = await api.tags.operation(operation.id);
  }
  if (process.stderr.isTTY) {
    process.stderr.write("\r\x1b[K");
  }
  return operation;
};

const reportTagOperation = (
  operation: TagOperation,
  options: GlobalOptions
) => {
  write(options.json ? operation : describeTagOperation(operation), options);
  if (operation.status === "failed") {
    process.exitCode = EXIT.api;
  }
};

export const startTagOperation = async (
  kind: TagOperation["kind"],
  from: string,
  to: string | undefined,
  options: ClientOptions & {
    intervalMs?: number;
    wait?: boolean;
    yes?: boolean;
  }
) => {
  if (kind === "delete" && !options.yes) {
    if (!process.stdin.isTTY) {
      throw new InvalidArgumentError(
        "Deleting a tag changes every card that has it; add --yes to confirm"
      );
    }
    if (
      !(await confirm(
        `Remove "${from}" from every card? This can't be undone.`
      ))
    ) {
      write(options.json ? { deleted: false } : "Nothing changed.", options);
      return;
    }
  }
  const api = client(options);
  let operation: TagOperation;
  if (kind === "rename") {
    operation = await api.tags.rename(from, to ?? "");
  } else if (kind === "merge") {
    operation = await api.tags.merge(from, to ?? "");
  } else {
    operation = await api.tags.delete(from);
  }
  if (options.wait) {
    operation = await waitForTagOperation(api, operation, options.intervalMs);
  }
  reportTagOperation(operation, options);
};

export const tagOperationStatus = async (
  id: string,
  options: ClientOptions & { intervalMs?: number; wait?: boolean }
) => {
  const api = client(options);
  let operation = await api.tags.operation(id);
  if (options.wait) {
    operation = await waitForTagOperation(api, operation, options.intervalMs);
  }
  reportTagOperation(operation, options);
};

/** One highlight: its id and quote on a line, its note indented below. */
export const formatHighlight = (highlight: Highlight) => {
  const quote = highlight.quote.replace(/\s+/g, " ").trim();
  const lines = [
    `${highlight.id}  ${quote}${highlight.anchored ? "" : "  (not found in the saved article yet)"}`,
  ];
  if (highlight.note) {
    lines.push(
      ...highlight.note.split("\n").map((line) => `    ${line}`.trimEnd())
    );
  }
  return lines.join("\n");
};

export const listHighlights = async (
  cardId: string,
  options: GlobalOptions
) => {
  const result = await client(options).highlights.list(cardId);
  write(
    options.json ? result : result.items.map(formatHighlight).join("\n"),
    options
  );
};

export const addHighlight = async (
  cardId: string,
  quote: string,
  options: GlobalOptions & { note?: string; prefix?: string; suffix?: string }
) => {
  const highlight = await client(options).highlights.create(cardId, {
    quote,
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    ...(options.suffix === undefined ? {} : { suffix: options.suffix }),
  });
  write(options.json ? highlight : formatHighlight(highlight), options);
};

export const noteHighlight = async (
  id: string,
  text: string | undefined,
  options: GlobalOptions & { clear?: boolean }
) => {
  if (options.clear === true && text !== undefined) {
    throw new InvalidArgumentError("give the note's text or --clear, not both");
  }
  if (options.clear !== true && text === undefined) {
    throw new InvalidArgumentError("give the note's text, or --clear");
  }
  const highlight = await client(options).highlights.update(id, {
    note: options.clear === true ? null : (text as string),
  });
  write(options.json ? highlight : formatHighlight(highlight), options);
};

export const removeHighlights = async (
  ids: string[],
  options: GlobalOptions
) => {
  const api = client(options);
  const { failed, succeeded } = await eachCard(ids, (id) =>
    api.highlights.delete(id)
  );
  writeBatch(
    options.json
      ? {
          ...(failed.length > 0 ? { failed: failed.map(failureJson) } : {}),
          deleted: succeeded,
        }
      : succeeded.map((id) => `Removed highlight ${id}`).join("\n"),
    failed,
    options
  );
};
