#!/usr/bin/env bun
/**
 * Fills a Teak account with a varied library, for the account Claude's
 * directory reviewers sign in with (.agents/runbooks/claude-directory.md) and for
 * demos. Safe to run again: it reads the library first and saves only what
 * is missing.
 *
 *   TEAK_API_KEY=teakapi_... bun --no-env-file run scripts/seed/seed-demo-account.ts
 *     [--api https://teakvault.com/api] [--dry-run]
 *
 * The key belongs to the account being filled; never a personal account.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CreateCardInput,
  createTeakClient,
  staticTokenProvider,
  type TeakClient,
} from "../../packages/sdk/src/index.ts";

export interface SeedCard {
  favorite?: boolean;
  folder?: string;
  input: CreateCardInput;
}

export interface SeedImage {
  favorite?: boolean;
  folder?: string;
  name: string;
  path: string;
  tags: string[];
}

const link = (
  url: string,
  tags: string[],
  extra: Omit<SeedCard, "input"> & { notes?: string } = {}
): SeedCard => ({
  favorite: extra.favorite,
  folder: extra.folder,
  input: { notes: extra.notes, tags, url },
});

const text = (
  content: string,
  tags: string[],
  extra: Omit<SeedCard, "input"> = {}
): SeedCard => ({ ...extra, input: { content, tags } });

export const DEMO_FOLDERS = [
  { color: "orange", name: "Design inspiration" },
  { color: "blue", name: "Reading list" },
  { color: "green", name: "Redesign" },
] as const;

export const DEMO_SMART_FOLDER = {
  kind: "smart",
  name: "Palettes",
  query: "type:palette",
} as const;

export const DEMO_CARDS: SeedCard[] = [
  link("https://en.wikipedia.org/wiki/Bauhaus", ["design", "history"], {
    folder: "Design inspiration",
  }),
  link(
    "https://en.wikipedia.org/wiki/International_Typographic_Style",
    ["typography", "design", "history"],
    { favorite: true, folder: "Design inspiration" }
  ),
  link("https://en.wikipedia.org/wiki/Dieter_Rams", ["design", "product"], {
    folder: "Design inspiration",
    notes: "Ten principles for good design: use them for the redesign review.",
  }),
  link("https://en.wikipedia.org/wiki/Massimo_Vignelli", ["design"], {
    folder: "Design inspiration",
  }),
  link("https://en.wikipedia.org/wiki/Helvetica", ["typography", "fonts"]),
  link("https://en.wikipedia.org/wiki/Golden_ratio", ["design", "math"]),
  link("https://en.wikipedia.org/wiki/Color_theory", ["color", "design"], {
    folder: "Redesign",
  }),
  link(
    "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout",
    ["css", "layout", "frontend"],
    { folder: "Redesign" }
  ),
  link(
    "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout",
    ["css", "layout", "frontend"]
  ),
  link(
    "https://developer.mozilla.org/en-US/docs/Web/Accessibility",
    ["accessibility", "frontend"],
    { favorite: true, folder: "Redesign" }
  ),
  link("https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch", [
    "css",
    "color",
  ]),
  link("https://web.dev/articles/vitals", ["performance", "frontend"], {
    folder: "Reading list",
  }),
  link("https://www.w3.org/WAI/standards-guidelines/wcag/", ["accessibility"]),
  link("https://github.com/praveenjuge/teak", ["open-source", "teak"], {
    favorite: true,
  }),
  link("https://react.dev/learn", ["react", "frontend"], {
    folder: "Reading list",
  }),
  link("https://bun.sh/docs", ["tools", "javascript"]),
  link("https://modelcontextprotocol.io/introduction", ["ai", "mcp"], {
    folder: "Reading list",
    notes: "How Claude talks to Teak.",
  }),
  link("https://en.wikipedia.org/wiki/Zettelkasten", ["notes", "knowledge"], {
    favorite: true,
    folder: "Reading list",
  }),
  link("https://en.wikipedia.org/wiki/Commonplace_book", ["notes", "history"], {
    folder: "Reading list",
  }),
  link("https://en.wikipedia.org/wiki/Spaced_repetition", [
    "learning",
    "knowledge",
  ]),
  link("https://en.wikipedia.org/wiki/Brutalist_architecture", [
    "architecture",
    "inspiration",
  ]),
  link("https://en.wikipedia.org/wiki/Mid-century_modern", [
    "architecture",
    "design",
    "inspiration",
  ]),
  link("https://en.wikipedia.org/wiki/Wabi-sabi", ["inspiration", "design"]),
  link("https://www.youtube.com/watch?v=jNQXAC9IVRw", ["video", "history"]),
  text(
    "# Redesign checklist\n\n- Audit color contrast against WCAG AA\n- Move the type scale to a 1.25 ratio\n- Replace the grid with CSS subgrid\n- Test the new navigation with five people",
    ["redesign", "todo"],
    { favorite: true, folder: "Redesign" }
  ),
  text(
    "# Interview notes: onboarding\n\nPeople skip the tour, then look for import. Show import on the empty library instead of a tour. Three of five asked how search by color works.",
    ["research", "onboarding"],
    { folder: "Redesign" }
  ),
  text(
    "# Reading habits\n\nSave first, read on Sunday. Tag anything worth a second look with `revisit`.",
    ["notes", "habits"]
  ),
  text(
    "# Gift ideas\n\n- Field notebook for Sam\n- Pour-over kettle\n- A print from the Bauhaus archive shop",
    ["personal", "ideas"]
  ),
  text(
    "# Talk outline: designing for recall\n\n1. Why we lose what we save\n2. Search by meaning, not folders\n3. Resurfacing: shuffle and revisit\n4. Demo",
    ["talks", "knowledge"]
  ),
  text(
    "# Weekly review\n\nWhat did I save that I used? What did I save that I never opened? Archive the second list.",
    ["habits", "todo"]
  ),
  text(
    '"Good design is as little design as possible." — Dieter Rams',
    ["quotes", "design"],
    { favorite: true }
  ),
  text('"Simplicity is prerequisite for reliability." — Edsger W. Dijkstra', [
    "quotes",
    "engineering",
  ]),
  text(
    '"The details are not the details. They make the design." — Charles Eames',
    ["quotes", "design"]
  ),
  text('"What we see depends mainly on what we look for." — John Lubbock', [
    "quotes",
    "inspiration",
  ]),
  text('"Make it work, make it right, make it fast." — Kent Beck', [
    "quotes",
    "engineering",
  ]),
  text("#1F2937 #F97316 #FDBA74 #FFF7ED", ["palette", "warm"], {
    favorite: true,
  }),
  text("#0F172A #1E3A8A #3B82F6 #BFDBFE #F8FAFC", ["palette", "cool"]),
  text("#14532D #16A34A #86EFAC #F0FDF4", ["palette", "nature"]),
  text("#3F3F46 #A1A1AA #E4E4E7 #FAFAFA", ["palette", "neutral"]),
  text("#7C2D12 #EA580C #FACC15 #FEF3C7 #1C1917", ["palette", "autumn"]),
];

const DEMO_IMAGE_DIR = join(
  import.meta.dir,
  "../../apps/docs/public/home-demo"
);

export const DEMO_IMAGES: SeedImage[] = [
  {
    folder: "Design inspiration",
    name: "Concrete tower.webp",
    path: "building-full.webp",
    tags: ["architecture", "inspiration"],
  },
  {
    name: "Film camera.webp",
    path: "camera-full.webp",
    tags: ["photography", "product"],
  },
  {
    favorite: true,
    folder: "Design inspiration",
    name: "Designer's desk.webp",
    path: "desk-full.webp",
    tags: ["workspace", "inspiration"],
  },
  {
    name: "Clothes rail.webp",
    path: "hangers-full.webp",
    tags: ["fashion", "inspiration"],
  },
  {
    name: "Denim jacket.webp",
    path: "jacket-full.webp",
    tags: ["fashion", "product"],
  },
  {
    folder: "Redesign",
    name: "Laptop flat lay.webp",
    path: "laptop-flatlay-full.webp",
    tags: ["workspace", "product"],
  },
];

const normalizeText = (value: string) =>
  value.replace(/["“”]/gu, "").replace(/\s+/gu, " ").trim();

const readLibrary = async (teak: TeakClient) => {
  const urls = new Set<string>();
  const texts = new Set<string>();
  const fileNames = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await teak.cards.list({
      cursor,
      include: "content,metadata",
      limit: 100,
    });
    for (const card of page.items) {
      if (card.url) {
        urls.add(card.url);
      }
      if (card.content) {
        texts.add(normalizeText(card.content));
      }
      if (card.fileName) {
        fileNames.add(card.fileName);
      }
    }
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return { fileNames, texts, urls };
};

const parseArgs = (argv: string[]) => {
  const apiIndex = argv.indexOf("--api");
  return {
    api: apiIndex >= 0 ? argv[apiIndex + 1] : undefined,
    dryRun: argv.includes("--dry-run"),
  };
};

export const seedDemoAccount = async (
  teak: TeakClient,
  { dryRun = false, log = console.log } = {}
) => {
  const library = await readLibrary(teak);
  const folders = new Map(
    (await teak.folders.list()).items.map((folder) => [folder.name, folder.id])
  );
  const favorites: string[] = [];
  const byFolder = new Map<string, string[]>();
  const place = (
    cardId: string,
    entry: { favorite?: boolean; folder?: string }
  ) => {
    if (entry.favorite) {
      favorites.push(cardId);
    }
    if (entry.folder) {
      byFolder.set(entry.folder, [
        ...(byFolder.get(entry.folder) ?? []),
        cardId,
      ]);
    }
  };
  let created = 0;
  let skipped = 0;

  for (const entry of DEMO_CARDS) {
    const { input } = entry;
    const exists = input.url
      ? (await teak.cards.duplicate(input.url)) !== null
      : library.texts.has(normalizeText(input.content ?? ""));
    if (exists) {
      skipped += 1;
      continue;
    }
    log(`save ${input.url ?? normalizeText(input.content ?? "").slice(0, 60)}`);
    if (!dryRun) {
      const result = await teak.cards.create({ ...input, source: "demo-seed" });
      place(result.cardId, entry);
    }
    created += 1;
  }

  for (const image of DEMO_IMAGES) {
    const fileName = image.name;
    if (library.fileNames.has(fileName)) {
      skipped += 1;
      continue;
    }
    log(`upload ${fileName}`);
    if (!dryRun) {
      const bytes = readFileSync(join(DEMO_IMAGE_DIR, image.path));
      const upload = await teak.uploads.create({
        fileName,
        fileSize: bytes.byteLength,
        mimeType: "image/webp",
      });
      const { fileEtag } = await teak.uploads.putFile(
        upload.uploadUrl,
        bytes,
        "image/webp"
      );
      const result = await teak.cards.create({
        fileEtag,
        fileKey: upload.fileKey,
        fileName,
        fileSize: bytes.byteLength,
        mimeType: "image/webp",
        source: "demo-seed",
        tags: image.tags,
      });
      place(result.cardId, image);
    }
    created += 1;
  }

  for (const folder of DEMO_FOLDERS) {
    if (!folders.has(folder.name)) {
      log(`folder ${folder.name}`);
      if (!dryRun) {
        folders.set(folder.name, (await teak.folders.create(folder)).id);
      }
    }
  }
  if (!folders.has(DEMO_SMART_FOLDER.name)) {
    log(`smart folder ${DEMO_SMART_FOLDER.name}`);
    if (!dryRun) {
      await teak.folders.create(DEMO_SMART_FOLDER);
    }
  }
  for (const [name, cardIds] of byFolder) {
    const folderId = folders.get(name);
    if (folderId && cardIds.length > 0) {
      await teak.folders.addCards(folderId, cardIds);
    }
  }
  for (const cardId of favorites) {
    await teak.cards.setFavorite(cardId, true);
  }

  log(
    `${dryRun ? "Would save" : "Saved"} ${created} cards; ${skipped} already there.`
  );
  return { created, skipped };
};

if (import.meta.main) {
  const token = process.env.TEAK_API_KEY;
  if (!token?.startsWith("teakapi_")) {
    console.error(
      "Set TEAK_API_KEY to an API key of the account to fill (Settings → API keys)."
    );
    process.exit(1);
  }
  const { api, dryRun } = parseArgs(process.argv.slice(2));
  const teak = createTeakClient({
    baseUrl: api,
    tokenProvider: staticTokenProvider(token),
    userAgent: "teak-demo-seed",
  });
  const me = await teak.me();
  console.log(`Filling ${me.email} (${me.plan}, ${me.cardCount} cards)`);
  await seedDemoAccount(teak, { dryRun });
}
