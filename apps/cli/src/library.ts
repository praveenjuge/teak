import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type CardsPage,
  type ExportJob,
  type LatestExport,
  TeakApiError,
  type TeakClient,
} from "@teak/convex/sdk";
import { InvalidArgumentError } from "commander";
import {
  type ClientOptions,
  client,
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
  for (const id of ids) {
    await api.cards.delete(id, { permanent: options.permanent });
  }
  const done = options.permanent
    ? (id: string) => `Deleted ${id} forever`
    : (id: string) => `Moved ${id} to Trash. Undo with: teak restore ${id}`;
  write(
    options.json
      ? { deletedIds: ids, permanent: Boolean(options.permanent) }
      : ids.map(done).join("\n"),
    options
  );
};

export const restoreCards = async (ids: string[], options: GlobalOptions) => {
  const api = client(options);
  for (const id of ids) {
    await api.cards.restore(id);
  }
  write(
    options.json
      ? { restoredIds: ids }
      : ids.map((id) => `Restored ${id}`).join("\n"),
    options
  );
};

export const openCard = async (id: string, options: GlobalOptions) => {
  const card = await client(options).cards.get(id);
  openBrowser(card.appUrl);
  write(options.json ? { appUrl: card.appUrl } : card.appUrl, options);
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

const waitForExport = async (api: TeakClient, intervalMs: number) => {
  let latest = await api.exports.latest();
  while (isActive(latest.job)) {
    // Progress only helps someone watching; keep piped output quiet.
    if (process.stderr.isTTY && latest.job?.processedCount) {
      process.stderr.write(`\r${latest.job.processedCount} cards processed…`);
    }
    await sleep(intervalMs);
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
      ? await waitForExport(api, options.intervalMs ?? 3000)
      : await api.exports.latest();
  if (options.output && latest.job?.downloadUrl) {
    await downloadExport(options);
    return;
  }
  write(options.json ? latest : describeExport(latest), options);
};
