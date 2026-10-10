/**
 * Puts the showcase library (showcase.ts) at the top of the Teak account the
 * CLI is signed in to, so every app opens on it.
 *
 *   bun scripts/store-assets/seed.ts            report what is missing
 *   bun scripts/store-assets/seed.ts --apply    add the missing cards
 *   bun scripts/store-assets/seed.ts --refresh  move existing showcase cards to
 *                                               Trash, then add the whole set
 *
 * It runs the repository's CLI (apps/cli), built first with
 * `bun run build:cli`. Cards are matched by URL, text, or file name, so no
 * marker tag shows up in the screenshots.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { SHOWCASE, type ShowcaseCard } from "./showcase.ts";

interface CardSummary {
  content: string;
  id: string;
  metadataTitle?: string | null;
  type: string;
  url?: string | null;
}

const root = path.resolve(import.meta.dir, "../..");
const cli = path.join(root, "apps/cli/dist/index.js");
const seedDir = path.join(import.meta.dir, "seed");

const teak = async (args: string[]): Promise<unknown> => {
  const proc = Bun.spawn(["bun", cli, "--json", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`teak ${args[0]} failed: ${err.trim() || out.trim()}`);
  }
  return out.trim() ? JSON.parse(out) : null;
};

const FILE_TYPES: Record<string, string> = {
  ".jpg": "image",
  ".m4a": "audio",
  ".pdf": "document",
};

// Keys pair the card type with its URL, text, or file name, so a personal
// card that merely shares a quote or file name is never matched.
const key = (card: ShowcaseCard): string => {
  if (card.kind === "file") {
    return `${FILE_TYPES[path.extname(card.file)]}:${card.file}`;
  }
  if (card.kind === "link") {
    return `link:${card.url}`;
  }
  return `${card.kind}:${card.content}`;
};

const keysFor = (card: CardSummary): string[] => {
  if (card.type === "link") {
    return [`link:${card.url ?? ""}`];
  }
  if (["text", "quote", "palette"].includes(card.type)) {
    return [`${card.type}:${card.content}`];
  }
  return [`${card.type}:${card.metadataTitle ?? ""}`];
};

/**
 * Pages through the library, newest first, until every showcase card is found
 * or the library ends, so a refresh never misses older showcase cards.
 */
const libraryUntilFound = async (
  wanted: Set<string>
): Promise<CardSummary[]> => {
  const cards: CardSummary[] = [];
  const found = new Set<string>();
  let cursor: string | undefined;
  while (found.size < wanted.size) {
    const page = (await teak([
      "ls",
      "--limit",
      "100",
      ...(cursor ? ["--cursor", cursor] : []),
    ])) as {
      items: CardSummary[];
      pageInfo: { hasMore: boolean; nextCursor?: string };
    };
    cards.push(...page.items);
    for (const card of page.items) {
      for (const cardKey of keysFor(card)) {
        if (wanted.has(cardKey)) {
          found.add(cardKey);
        }
      }
    }
    if (!(page.pageInfo.hasMore && page.pageInfo.nextCursor)) {
      break;
    }
    cursor = page.pageInfo.nextCursor;
  }
  return cards;
};

const addArgs = (card: ShowcaseCard): string[] => {
  const args = ["add"];
  if (card.kind === "file") {
    args.push("--file", path.join(seedDir, card.file));
  } else if (card.kind === "link") {
    args.push(card.url);
  } else {
    args.push(card.content, "--type", card.kind);
  }
  if (card.notes) {
    args.push("--notes", card.notes);
  }
  if (card.tags?.length) {
    args.push("--tags", card.tags.join(","));
  }
  return args;
};

const modes = ["--refresh", "--apply"] as const;
const flag = modes.find((name) => process.argv.includes(name));
const mode = flag ? flag.slice(2) : "check";

if (!existsSync(cli)) {
  throw new Error("Build the CLI first: bun run build:cli");
}
for (const card of SHOWCASE) {
  if (card.kind === "file" && !existsSync(path.join(seedDir, card.file))) {
    throw new Error(`Missing seed file: ${card.file}`);
  }
  if (card.kind === "file" && !FILE_TYPES[path.extname(card.file)]) {
    throw new Error(
      `Add ${path.extname(card.file)} to FILE_TYPES: ${card.file}`
    );
  }
}

const showcaseKeys = new Set(SHOWCASE.map(key));
const recent = await libraryUntilFound(showcaseKeys);
const existing = new Map<string, CardSummary>();
for (const card of recent) {
  for (const cardKey of keysFor(card)) {
    existing.set(cardKey, card);
  }
}
const leading = recent.findIndex(
  (card) => !keysFor(card).some((cardKey) => showcaseKeys.has(cardKey))
);
const missing = SHOWCASE.filter((card) => !existing.has(key(card)));
console.log(
  `${SHOWCASE.length - missing.length} of ${SHOWCASE.length} showcase cards found; ` +
    `the newest ${leading === -1 ? recent.length : leading} cards are all showcase.`
);

if (mode === "check") {
  for (const card of missing) {
    console.log(`missing  ${key(card)}`);
  }
  process.exit(0);
}

let toAdd = missing;
if (mode === "refresh") {
  // Every match, so duplicates from an interrupted run go too.
  const ids = recent
    .filter((card) =>
      keysFor(card).some((cardKey) => showcaseKeys.has(cardKey))
    )
    .map((card) => card.id);
  if (ids.length) {
    await teak(["rm", ...ids]);
    console.log(`Moved ${ids.length} older showcase cards to Trash.`);
  }
  toAdd = SHOWCASE;
}

// Oldest first, so the first showcase entry ends up newest.
for (const card of [...toAdd].reverse()) {
  const created = (await teak(addArgs(card))) as { cardId: string };
  if ("title" in card && card.title) {
    await teak(["cards", "update", created.cardId, "--title", card.title]);
  }
  if (card.favorite) {
    await teak(["fav", created.cardId]);
  }
  console.log(`added    ${key(card)}`);
}
console.log(
  `Added ${toAdd.length} cards. Link previews and AI tags finish in the background.`
);
