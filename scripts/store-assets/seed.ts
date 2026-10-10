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

const key = (card: ShowcaseCard): string => {
  if (card.kind === "file") {
    return `file:${card.file}`;
  }
  if (card.kind === "link") {
    return `link:${card.url}`;
  }
  return `text:${card.content}`;
};

const keysFor = (card: CardSummary): string[] => [
  `file:${card.metadataTitle ?? ""}`,
  `link:${card.url ?? ""}`,
  `text:${card.content}`,
];

const recentCards = async (limit: number): Promise<CardSummary[]> => {
  const cards: CardSummary[] = [];
  let cursor: string | undefined;
  while (cards.length < limit) {
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
    if (!(page.pageInfo.hasMore && page.pageInfo.nextCursor)) {
      break;
    }
    cursor = page.pageInfo.nextCursor;
  }
  return cards.slice(0, limit);
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
}

const recent = await recentCards(SHOWCASE.length * 4);
const existing = new Map<string, CardSummary>();
for (const card of recent) {
  for (const cardKey of keysFor(card)) {
    existing.set(cardKey, card);
  }
}
const showcaseKeys = new Set(SHOWCASE.map(key));
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
  const ids = SHOWCASE.flatMap((card) => {
    const found = existing.get(key(card));
    return found ? [found.id] : [];
  });
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
