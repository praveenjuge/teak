import path from "node:path";

/**
 * Seeds what the Features shots need on top of the store showcase
 * (`scripts/store-assets/seed.ts --apply`): a folder of architecture
 * references, a note that links two cards with `[[`, a note with a table, and
 * a Wikipedia article with a highlight for the reader.
 * Uses the CLI with TEAK_API_KEY and TEAK_API_URL, like the store seed, and
 * adds only what's missing.
 */

interface Card {
  article?: { wordCount: number } | null;
  content?: string | null;
  id: string;
  metadataTitle?: string | null;
  type: string;
  url?: string | null;
}

import { ARTICLE, FOLDER, LINKS_NOTE, TABLE_NOTE } from "./seed-names.ts";

const root = path.resolve(import.meta.dir, "../..");
const cli = path.join(root, "apps/cli/dist/index.js");

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

const FOLDER_IMAGES = [
  "Fallingwater.jpg",
  "Axel Towers, Copenhagen.jpg",
  "Curved oak ceiling.jpg",
  "Spiral staircase.jpg",
  "White concrete curves.jpg",
  "Concrete skylights.jpg",
  "Clay vases.jpg",
  "Eames lounge by the fire.jpg",
];
const HIGHLIGHT =
  "The house includes multiple outdoor terraces, which are cantilevered, extending outward from a chimney without support at the opposite end.";

const library = async () => {
  const cards: Card[] = [];
  let cursor: string | undefined;
  do {
    const page = (await teak([
      "ls",
      "--limit",
      "100",
      ...(cursor ? ["--cursor", cursor] : []),
    ])) as {
      items: Card[];
      pageInfo: { hasMore: boolean; nextCursor?: string };
    };
    cards.push(...page.items);
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : undefined;
  } while (cursor);
  return cards;
};

const byTitle = (cards: Card[], title: string) => {
  const card = cards.find((item) => item.metadataTitle === title);
  if (!card) {
    throw new Error(
      `Missing showcase card ${title}: run scripts/store-assets/seed.ts --apply`
    );
  }
  return card;
};

const cards = await library();
const hasNote = (heading: string) =>
  cards.some(
    (card) => card.type === "text" && card.content?.startsWith(`# ${heading}`)
  );

const folders = (await teak(["folders", "ls"])) as {
  items: { name: string }[];
};
if (folders.items.some((folder) => folder.name === FOLDER)) {
  console.log(`exists   folder ${FOLDER}`);
} else {
  await teak(["folders", "create", FOLDER, "--color", "amber"]);
  await teak([
    "folders",
    "add",
    FOLDER,
    ...FOLDER_IMAGES.map((title) => byTitle(cards, title).id),
  ]);
  console.log(`added    folder ${FOLDER}`);
}

if (hasNote(LINKS_NOTE)) {
  console.log(`exists   note ${LINKS_NOTE}`);
} else {
  const fallingwater = byTitle(cards, "Fallingwater.jpg").id;
  const oak = byTitle(cards, "Curved oak ceiling.jpg").id;
  await teak([
    "add",
    [
      `# ${LINKS_NOTE}`,
      "",
      `Start from [[Fallingwater|teak:${fallingwater}]]: stone, water and the house as one composition.`,
      "",
      `Warm the reception with timber, like the [[Curved oak ceiling|teak:${oak}]], and keep the light low and indirect.`,
    ].join("\n"),
    "--type",
    "text",
    "--tags",
    "halden",
  ]);
  console.log(`added    note ${LINKS_NOTE}`);
}

if (hasNote(TABLE_NOTE)) {
  console.log(`exists   note ${TABLE_NOTE}`);
} else {
  await teak([
    "add",
    [
      `# ${TABLE_NOTE}`,
      "",
      "| Style | Size | Line height | Tracking |",
      "| --- | --- | --- | --- |",
      "| Display | 64 | 72 | -2% |",
      "| Heading | 32 | 40 | -1% |",
      "| Body | 17 | 28 | 0 |",
      "| Caption | 13 | 20 | +2% |",
      "",
      "A sharp serif for headlines, a quiet grotesk for body.",
    ].join("\n"),
    "--type",
    "text",
    "--tags",
    "halden,typography",
  ]);
  console.log(`added    note ${TABLE_NOTE}`);
}

let articleId = cards.find((card) => card.url === ARTICLE)?.id;
if (articleId) {
  console.log(`exists   link ${ARTICLE}`);
} else {
  articleId = (
    (await teak(["add", ARTICLE, "--tags", "architecture,reading"])) as {
      cardId: string;
    }
  ).cardId;
  console.log(`added    link ${ARTICLE}`);
}
for (let tries = 0; ; tries += 1) {
  const card = (await teak(["cards", "get", articleId])) as Card;
  if (card.article) {
    break;
  }
  if (tries === 30) {
    throw new Error(
      `The article for ${ARTICLE} isn't ready yet; run this again`
    );
  }
  await Bun.sleep(5000);
}
const highlights = (await teak(["highlights", "ls", articleId])) as {
  items: unknown[];
};
if (highlights.items.length) {
  console.log("exists   highlight");
} else {
  await teak([
    "highlights",
    "add",
    articleId,
    HIGHLIGHT,
    "--note",
    "The brief for the Halden lobby: the building and the landscape as one.",
  ]);
  console.log("added    highlight");
}
