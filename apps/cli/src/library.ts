import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type CardsPage,
  type ExportJob,
  type Folder,
  type FolderColor,
  type LatestExport,
  TeakApiError,
  type TeakClient,
} from "@teak/convex/sdk";
import { InvalidArgumentError } from "commander";
import {
  type ClientOptions,
  client,
  exitCodeFor,
  type GlobalOptions,
  openBrowser,
  write,
} from "./runtime";

type PageFetcher = (cursor?: string) => Promise<CardsPage>;

/** One page, or every page when `all` is set. */
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
  while (cursor) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.pageInfo.nextCursor;
  }
  return { items, pageInfo: { hasMore: false, nextCursor: null } };
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

/** Runs one request per card, so one bad id doesn't stop the rest. */
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

// Prints what succeeded, lists failures on stderr, and exits non-zero (with
// the first failure's code) when any card failed.
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
  // Only Trash can be emptied; a card that isn't there yet moves first.
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

/** Archives cards (hidden from the library, not deleted) or returns them. */
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

const writeNewFile = (target: string, bytes: Uint8Array, force?: boolean) => {
  if (existsSync(target) && !force) {
    throw new InvalidArgumentError(
      `${target} already exists; pass --force to replace it`
    );
  }
  writeFileSync(target, bytes);
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// File and export links come from the Teak API. Follow only web links, so a
// bad response can't point the CLI at another scheme or an internal host.
const downloadUrl = (url: string) => {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL; rejected below.
  }
  if (
    parsed?.protocol === "https:" ||
    (parsed?.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
  ) {
    return parsed;
  }
  throw new TeakApiError(
    "REQUEST_FAILED",
    "Teak returned a download link that isn't a web address"
  );
};

const fetchBytes = async (url: string) => {
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await fetch(downloadUrl(url));
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
  writeNewFile(target, await fetchBytes(card.fileUrl), options.force);
  write(options.json ? { path: target } : `Saved ${target}`, options);
};

const planLine = (me: Awaited<ReturnType<TeakClient["me"]>>) =>
  me.plan === "pro"
    ? `Pro plan · ${me.cardCount} cards`
    : `Free plan · ${me.cardCount} of ${me.cardLimit} cards`;

export const whoami = async (options: GlobalOptions) => {
  const me = await client(options).me();
  write(options.json ? me : `${me.email}\n${planLine(me)}`, options);
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

/** Adds tags, or removes them from both the card's own tags and AI tags. */
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

// Small exports finish in moments, so poll quickly at first and back off to
// every few seconds for large ones.
const FIRST_POLL_MS = 250;
const MAX_POLL_MS = 3000;

const waitForExport = async (api: TeakClient, intervalMs?: number) => {
  let latest = await api.exports.latest();
  let delay = intervalMs ?? FIRST_POLL_MS;
  while (isActive(latest.job)) {
    // Progress only helps someone watching; keep piped output quiet.
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
  const api = client(options);
  try {
    await api.exports.start();
  } catch (error) {
    // A running export is fine to wait on; a weekly limit is not an error
    // worth hiding, so show when the next one is possible.
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
};

/** A folder by id, or by name ignoring case, among the account's folders. */
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
    String(folder.cardCount).padStart(4),
    folder.color ? `${folder.name} (${folder.color})` : folder.name,
  ].join("  ");

export const listFolders = async (options: GlobalOptions) => {
  const result = await client(options).folders.list();
  write(
    options.json ? result : result.items.map(formatFolderLine).join("\n"),
    options
  );
};

export const createFolder = async (
  name: string,
  options: GlobalOptions & { color?: FolderColor }
) => {
  const folder = await client(options).folders.create({
    name,
    ...(options.color ? { color: options.color } : {}),
  });
  write(options.json ? folder : formatFolderLine(folder), options);
};

/** Renames a folder, recolors it ("none" clears the color), or both. */
export const updateFolder = async (
  ref: string,
  name: string | undefined,
  options: GlobalOptions & { color?: FolderColor | "none" }
) => {
  if (name === undefined && options.color === undefined) {
    throw new InvalidArgumentError("give a new name or --color");
  }
  const api = client(options);
  const folder = await resolveFolder(api, ref);
  const updated = await api.folders.update(folder.id, {
    ...(name === undefined ? {} : { name }),
    ...(options.color === undefined
      ? {}
      : { color: options.color === "none" ? null : options.color }),
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

/** Adds cards to a folder or removes them, 100 at a time. */
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
    if (!options.json) {
      const limited = new Set(folderLimitIds);
      process.stderr.write(
        `${failedIds
          .map(
            (id) =>
              `${id}: ${limited.has(id) ? "already in the most folders a card can be in" : "not found"}`
          )
          .join("\n")}\n`
      );
    }
    process.exitCode = exitCodeFor(new TeakApiError("NOT_FOUND"));
  }
};
