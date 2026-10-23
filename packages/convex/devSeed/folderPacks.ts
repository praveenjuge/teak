import type { DevScenarioCardDef } from "../card/defaultCards";
import {
  type FolderColor,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "../shared/folders";
import { SCENARIO_MARKER } from "./helpers";

export interface FolderScenarioCard
  extends Omit<DevScenarioCardDef, "folderIds"> {
  folders: number[];
}

export interface FolderScenarioPack {
  cards: FolderScenarioCard[];
  folders: { color?: FolderColor; name: string; query?: string }[];
}

export const FOLDER_SCENARIOS = [
  "folders-one",
  "folders-500",
  "card-in-50-folders",
  "folders-ugly",
  "search-qualifiers",
  "smart-folders",
  "export-ugly",
  "palette-mixed",
  "focus-notes",
  "checklists",
  "note-tables",
  "hidden-mix",
  "revisit-sizes",
  "save-details",
  "omnibox-titles",
  "ocr-images",
  "ocr-documents",
  "ocr-links",
  "done-states",
  "rich-sites",
  "video-captions",
  "podcast-transcripts",
  "email-in",
  "email-attachments",
] as const;
export type FolderScenario = (typeof FOLDER_SCENARIOS)[number];

export const FOLDER_SCENARIO_START = Date.UTC(2026, 8, 1);

export const folderScenarioCard = (
  scenario: FolderScenario,
  index: number,
  label: string,
  folders: number[],
  extra: Partial<DevScenarioCardDef> = {}
): FolderScenarioCard => {
  const base = {
    createdAt: FOLDER_SCENARIO_START + index * 3_600_000,
    tags: [`scenario-${scenario}`],
    folders,
    ...extra,
  };
  if (index === 0) {
    const url = `https://example.com/${scenario}#${SCENARIO_MARKER}-${scenario}`;
    return { ...base, type: "link", content: url, url, metadataTitle: label };
  }
  return { ...base, type: "text", content: label };
};

const FOLDER_COLOR_CYCLE: (FolderColor | undefined)[] = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  undefined,
];

export const foldersOnePack = (): FolderScenarioPack => {
  const states: [string, Partial<DevScenarioCardDef>][] = [
    ...Array.from({ length: 8 }, (): [string, Partial<DevScenarioCardDef>] => [
      "active",
      {},
    ]),
    ["archived", { isArchived: true }],
    ["archived", { isArchived: true }],
    ["in Trash", { isDeleted: true }],
    ["archived, in Trash", { isArchived: true, isDeleted: true }],
  ];
  const inFolder = states.map(([state, extra], index) =>
    folderScenarioCard(
      "folders-one",
      index,
      `In the folder #${String(index + 1).padStart(2, "0")}, ${state}`,
      [0],
      extra
    )
  );
  const outside = [0, 1, 2].map((offset) =>
    folderScenarioCard(
      "folders-one",
      states.length + offset,
      `In no folder #${offset + 1}`,
      []
    )
  );
  return {
    folders: [{ name: "Scenario folder", color: "teal" }],
    cards: [...inFolder, ...outside],
  };
};

export const folders500Pack = (): FolderScenarioPack => ({
  folders: Array.from({ length: MAX_FOLDERS_PER_USER }, (_, index) => ({
    name: `Folder ${String(index + 1).padStart(3, "0")}`,
    color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
  })),
  cards: [0, 1, 2].map((index) =>
    folderScenarioCard(
      "folders-500",
      index,
      `In Folder 001 and Folder ${String(500 - index).padStart(3, "0")}`,
      [0, 499 - index]
    )
  ),
});

export const cardIn50FoldersPack = (): FolderScenarioPack => {
  const all = Array.from({ length: MAX_FOLDERS_PER_CARD }, (_, index) => index);
  return {
    folders: Array.from({ length: MAX_FOLDERS_PER_CARD + 1 }, (_, index) => ({
      name: `Stack ${String(index + 1).padStart(2, "0")}`,
      color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
    })),
    cards: [
      folderScenarioCard(
        "card-in-50-folders",
        0,
        `In ${MAX_FOLDERS_PER_CARD} folders, the most a card can be in`,
        all
      ),
      folderScenarioCard(
        "card-in-50-folders",
        1,
        `In ${MAX_FOLDERS_PER_CARD - 1} folders, one short of the cap`,
        all.slice(0, -1)
      ),
    ],
  };
};

export const longName = (word: string) =>
  `${word} `.repeat(MAX_FOLDER_NAME_LENGTH).slice(0, MAX_FOLDER_NAME_LENGTH);

export const UGLY_FOLDER_NAMES = [
  "🎨 Moodboard ✨",
  "👩‍👩‍👧‍👦",
  "مجلد الأفكار",
  "רשימת קריאה",
  "東京のアイデア",
  "읽을 거리",
  "Ideas",
  "IDEAS",
  "ideas",
  longName("Longest"),
  "📚".repeat(MAX_FOLDER_NAME_LENGTH),
  "Two  spaces   inside",
  "<b>Not bold</b> & “quoted”",
  "Zürich",
];

const UGLY_CARD_STATES: Record<number, Partial<DevScenarioCardDef>> = {
  2: { isArchived: true },
  3: { isDeleted: true },
};

export const foldersUglyPack = (): FolderScenarioPack => ({
  folders: UGLY_FOLDER_NAMES.map((name, index) => ({
    name,
    color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
  })),
  cards: UGLY_FOLDER_NAMES.map((name, index) =>
    folderScenarioCard(
      "folders-ugly",
      index,
      `In “${Array.from(name).slice(0, 40).join("")}”`,
      [index],
      UGLY_CARD_STATES[index]
    )
  ),
});

export const SEARCH_QUALIFIER_HOSTS = [
  "https://github.com/teak/design-system",
  "https://www.github.com/teak/notes",
  "https://GitHub.com/teak/upper",
  "https://gist.github.com/teak/snippet",
  "https://www.example.com/page",
  "https://blog.example.com/post",
  "https://news.ycombinator.com/item",
  "https://dribbble.com/shots/1",
  "https://www.figma.com/file/a",
  "https://figma.com/community/b",
  "https://medium.com/@teak/design",
  "https://dev.to/teak/post",
  "https://stackoverflow.com/q/1",
  "https://www.youtube.com/watch?v=1",
  "https://m.youtube.com/watch?v=2",
  "https://vimeo.com/1",
  "https://arxiv.org/abs/1",
  "https://en.wikipedia.org/wiki/Design",
  "https://例え.jp/ページ",
  "https://xn--r8jz45g.jp/punycode",
  "https://bücher.example/buch",
  "http://192.168.1.20:8080/router",
  "http://localhost:3000/dev",
  "https://www.notion.so/page",
  "https://linear.app/teak/issue",
  "https://vercel.com/docs",
  "https://tailwindcss.com/docs",
  "https://www.reddit.com/r/design",
  "https://old.reddit.com/r/web",
  "https://example.com./trailing-dot",
] as const;

const SEARCH_QUALIFIER_TAGS = [
  ["Design"],
  ["design", "Systems"],
  ["DESIGN", "web design"],
  ["fff"],
  ["bad", "design"],
  ["Design Systems"],
  [],
] as const;

const SEARCH_QUALIFIER_TEXTS = [
  "A design system primer",
  "System design interview notes",
  "“Design system” with smart quotes",
  "Colour #fff swatches and the tag fff",
  'Notes that say "hi" in quotes',
  "Reading about design, systems and more",
] as const;

export const searchQualifiersPack = (): FolderScenarioPack => {
  const scenario = "search-qualifiers" as const;
  const extraFor = (index: number): Partial<DevScenarioCardDef> => ({
    tags: [
      `scenario-${scenario}`,
      ...SEARCH_QUALIFIER_TAGS[index % SEARCH_QUALIFIER_TAGS.length],
    ],
    ...(index % 5 === 2 ? { isFavorited: true } : {}),
    ...(index % 7 === 3 ? { isArchived: true } : {}),
    ...(index % 11 === 9 ? { isDeleted: true } : {}),
  });
  const links = SEARCH_QUALIFIER_HOSTS.map((url, offset) => {
    const index = offset + 1;
    const card = folderScenarioCard(scenario, index, "", [], extraFor(index));
    const markedUrl = `${url}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...card,
      type: "link" as const,
      content: markedUrl,
      url: markedUrl,
      metadataTitle: `${index % 2 === 0 ? "Design system" : "Notes"} on ${new URL(url).host}`,
      folders: [index % 4, (index + 1) % 5].filter((place) => place < 4),
    };
  });
  const texts = SEARCH_QUALIFIER_TEXTS.map((text, offset) => {
    const index = SEARCH_QUALIFIER_HOSTS.length + 1 + offset;
    return folderScenarioCard(scenario, index, text, [offset % 4], {
      tags: [
        `scenario-${scenario}`,
        ...SEARCH_QUALIFIER_TAGS[offset % SEARCH_QUALIFIER_TAGS.length],
      ],
    });
  });
  return {
    folders: [
      { name: "Reading list", color: "blue" },
      { name: 'Say "hi"', color: "amber" },
      { name: "Design refs", color: "violet" },
      { name: "Ideas & things", color: "green" },
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Search qualifiers pack", [0]),
      ...links,
      ...texts,
    ],
  };
};

const SMART_FOLDER_PHRASE = "the only card with this phrase";
const smartFolderLongQuery = () => {
  const head = "tag:scenario-smart-folders";
  const filler = Array.from({ length: 200 }, (_, index) => `w${index}`).join(
    " "
  );
  return `${head} ${filler}`.slice(0, MAX_SMART_FOLDER_QUERY_LENGTH).trim();
};

export const smartFoldersPack = (): FolderScenarioPack => {
  const scenario = "smart-folders" as const;
  const tagged = (...tags: string[]) => ({
    tags: [`scenario-${scenario}`, ...tags],
  });
  const designLink = (index: number, host: string, title: string) => {
    const url = `https://${host}/${index}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", [], tagged("design")),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
    };
  };
  return {
    folders: [
      { name: "Reading list", color: "blue" },
      {
        name: "Nothing matches",
        query: `tag:scenario-${scenario} tag:no-such-tag`,
      },
      {
        name: "Everything in the pack",
        color: "gray",
        query: `tag:scenario-${scenario}`,
      },
      {
        name: "Just one card",
        color: "amber",
        query: `"${SMART_FOLDER_PHRASE}"`,
      },
      {
        name: "Favorite reading",
        color: "pink",
        query: 'folder:"Reading list" is:fav',
      },
      { name: "Design links", color: "violet", query: "tag:design type:link" },
      { name: "🎨 Moodboard ✨", color: "orange", query: "#design tag:🎨" },
      { name: "مجلد ذكي للتصميم", color: "teal", query: '"تصميم"' },
      { name: "Five hundred characters", query: smartFolderLongQuery() },
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Smart folders pack", [0], tagged()),
      designLink(1, "dribbble.com/shots", "Design link on Dribbble"),
      designLink(2, "www.figma.com/file", "Design link on Figma"),
      folderScenarioCard(scenario, 3, "A favorite to read", [0], {
        ...tagged(),
        isFavorited: true,
      }),
      folderScenarioCard(
        scenario,
        4,
        "Read later, not a favorite",
        [0],
        tagged()
      ),
      folderScenarioCard(
        scenario,
        5,
        `This is ${SMART_FOLDER_PHRASE}.`,
        [],
        tagged()
      ),
      folderScenarioCard(
        scenario,
        6,
        "🎨 Palette ideas",
        [],
        tagged("design", "🎨")
      ),
      folderScenarioCard(
        scenario,
        7,
        "ملاحظات حول تصميم الواجهات",
        [],
        tagged()
      ),
      folderScenarioCard(scenario, 8, "Archived design note", [], {
        ...tagged("design"),
        isArchived: true,
      }),
    ],
  };
};

export const EXPORT_UGLY_FOLDER_NAMES = [
  'Quotes "and", commas',
  "Line one\nline two",
  "<script>alert(1)</script>",
  '=HYPERLINK("https://example.com","Click")',
  "🎨 Moodboard 😀",
  "مجلد الأفكار",
  "東京のアイデア",
  longName("Folder"),
];

export const exportUglyPack = (): FolderScenarioPack => {
  const scenario = "export-ugly" as const;
  const stacks = Array.from(
    { length: MAX_FOLDERS_PER_CARD },
    (_, index) => EXPORT_UGLY_FOLDER_NAMES.length + index
  );
  const ai = (summary: string, ...aiTags: string[]) => ({
    aiSummary: summary,
    aiTags,
  });
  const link = (
    index: number,
    title: string,
    folders: number[],
    extra: Partial<DevScenarioCardDef> = {}
  ) => {
    const url = `https://example.com/export-ugly/${index}?a=1&b="2"`;
    return {
      ...folderScenarioCard(scenario, index, "", folders, extra),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
    };
  };
  return {
    folders: [
      ...EXPORT_UGLY_FOLDER_NAMES.map((name, index) => ({
        name,
        color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
      })),
      ...stacks.map((_, index) => ({
        name: `Export stack ${String(index + 1).padStart(2, "0")}`,
      })),
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Export ugly pack", [0]),
      link(1, 'He said "hi", then left, quickly', [0, 1], {
        isFavorited: true,
        tags: [`scenario-${scenario}`, "a,b", "=SUM(1+1)"],
        ...ai('A summary, with a comma and "quotes".', "quotes", "commas"),
      }),
      link(2, '<script>alert("x")</script> & <b>bold</b>', [2], {
        isArchived: true,
        ...ai("<img src=x onerror=alert(1)>", "markup"),
      }),
      link(3, '=HYPERLINK("https://evil.example","Click me")', [3], {
        notes: "+1 for this\n-1 for that\n@someone",
      }),
      folderScenarioCard(
        scenario,
        4,
        'Line one\nLine two, with "quotes"\r\nLine three',
        [1],
        ai("-starts with a minus", "newlines")
      ),
      link(5, "🎨 مرحبا 東京 שלום 👩‍👩‍👧", [4, 5, 6], ai("多言語", "unicode")),
      link(6, longName("Title"), [7]),
      link(7, "In 50 folders", stacks, ai("A link in every stack", "stacks")),
      link(8, "Archived favorite, no AI", [], {
        isArchived: true,
        isFavorited: true,
      }),
      folderScenarioCard(scenario, 9, "@mention at the start", []),
      {
        ...folderScenarioCard(
          scenario,
          10,
          "+plus at the start",
          [],
          ai("A quote", "quote")
        ),
        type: "quote" as const,
      },
      folderScenarioCard(scenario, 11, "In Trash, left out of exports", [0], {
        isDeleted: true,
      }),
    ],
  };
};

export const PALETTE_MIXED_SMART_FOLDERS = [
  { name: "🔍 Palette marker cards", query: "tag:scenario-palette-mixed" },
  { name: "بحث ذكي", query: "palette marker" },
  { name: "スマートフォルダ", query: "type:link" },
  { name: "Smart IDEAS", query: "#ideas" },
  { name: longName("Smart"), query: "saved" },
  { name: "🧭".repeat(MAX_FOLDER_NAME_LENGTH), query: "is:fav" },
  { name: "Nothing matches", query: "zzqx-no-such-card" },
  { name: "Ordering links", query: "tag:scenario-ordering type:link" },
  { name: "רשימה חכמה", query: "note" },
  { name: "Palette sky", query: "sky" },
  { name: "smart ideas", query: "ideas" },
];

export const paletteMixedPack = (): FolderScenarioPack => {
  const scenario = "palette-mixed" as const;
  const manual = [
    ...UGLY_FOLDER_NAMES,
    ...Array.from(
      { length: 50 - (UGLY_FOLDER_NAMES.length - 2) },
      (_, index) => `Palette folder ${String(index + 1).padStart(2, "0")}`
    ),
  ];
  return {
    folders: [
      ...manual.map((name, index) => ({
        name,
        color: FOLDER_COLOR_CYCLE[index % FOLDER_COLOR_CYCLE.length],
      })),
      ...PALETTE_MIXED_SMART_FOLDERS,
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Palette marker link", [0]),
      ...[
        "Palette marker note",
        "Palette marker 🎨 emoji",
        "ملاحظة علامة اللوحة",
        "パレットのマーカー",
        `Palette marker ${longName("long")}`,
      ].map((label, index) =>
        folderScenarioCard(scenario, index + 1, label, [index + 1])
      ),
      folderScenarioCard(scenario, 6, "Palette marker archived", [], {
        isArchived: true,
      }),
      folderScenarioCard(scenario, 7, "Palette marker in Trash", [], {
        isDeleted: true,
      }),
    ],
  };
};
