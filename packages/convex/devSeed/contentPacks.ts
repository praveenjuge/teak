import type { DevScenarioCardDef } from "../card/defaultCards";
import { AUDIO_WAVEFORM } from "../card/onboarding/processed";
import { LINK_CATEGORIES, type LinkCategory } from "../shared/linkCategories";
import {
  type FolderScenarioCard,
  type FolderScenarioPack,
  folderScenarioCard,
  longName,
} from "./folderPacks";
import { SCENARIO_MARKER } from "./helpers";

const FOCUS_SENTENCES = [
  "The quiet morning light settled over the desk while the draft slowly took shape.",
  "Every paragraph asks for one clear idea and enough room to breathe.",
  "Long notes are where thinking happens, so the page should get out of the way.",
  "She crossed out the second heading and wrote a simpler one underneath.",
];

export const FOCUS_LONG_NOTE_WORDS = 50_000;
const focusLongNote = (): string => {
  const paragraphs: string[] = ["# A very long draft"];
  let words = 4;
  let index = 0;
  while (words < FOCUS_LONG_NOTE_WORDS) {
    const sentences: string[] = [];
    for (let i = 0; i < 6 && words < FOCUS_LONG_NOTE_WORDS; i++) {
      const sentence = FOCUS_SENTENCES[index % FOCUS_SENTENCES.length] ?? "";
      const sentenceWords = sentence.split(" ");
      const room = FOCUS_LONG_NOTE_WORDS - words;
      sentences.push(sentenceWords.slice(0, room).join(" "));
      words += Math.min(sentenceWords.length, room);
      index += 1;
    }
    paragraphs.push(sentences.join(" "));
  }
  return paragraphs.join("\n\n");
};

export const FOCUS_LITERAL_NOTE = [
  "# Release checklist",
  "",
  "| Step | Owner | Done |",
  "| --- | --- | --- |",
  "| Build | CI | yes |",
  "| Smoke test | Web | no |",
  "",
  "```ts",
  "export const ready = (steps: string[]) => steps.length > 0;",
  "```",
].join("\n");

export const focusNotesPack = (): FolderScenarioPack => {
  const scenario = "focus-notes" as const;
  const note = (index: number, content: string) =>
    folderScenarioCard(scenario, index, content, []);
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Focus notes pack", []),
      note(1, focusLongNote()),
      note(2, FOCUS_LITERAL_NOTE),
      note(3, ""),
      note(
        4,
        "東京の朝は静かで、ノートに考えを書きとめた。\n\n这是一段中文的笔记，用来测试字数。\n\nهذه ملاحظة قصيرة مكتوبة من اليمين إلى اليسار."
      ),
      note(
        5,
        `${longName("Focus")}\n\nThe body of a note whose first line is 300 characters.`
      ),
    ],
  };
};

export const SAVE_DETAILS_SAVED_URL = "https://example.com/already-saved";

export const saveDetailsPack = (): FolderScenarioPack => {
  const scenario = "save-details" as const;
  const quote = (
    index: number,
    content: string,
    sourceUrl: string,
    sourceTitle?: string
  ) =>
    folderScenarioCard(scenario, index, content, [], {
      sourceTitle,
      sourceUrl,
    });
  const link = (
    index: number,
    url: string,
    extra: Partial<DevScenarioCardDef> = {}
  ) => ({
    ...folderScenarioCard(scenario, index, "", [], extra),
    type: "link" as const,
    content: url,
    url,
  });
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Save details pack", []),
      quote(
        1,
        "Simplicity is a great virtue, but it requires hard work to achieve it.",
        "https://www.example.com/essays/simplicity",
        "On simplicity"
      ),
      quote(
        2,
        "A selection from a page whose title runs to 300 characters.",
        "https://example.org/a-very-long-title",
        longName("Title")
      ),
      quote(
        3,
        "اقتباس قصير من صفحة مكتوبة من اليمين إلى اليسار.",
        "https://example.net/rtl",
        "عنوان الصفحة باللغة العربية"
      ),
      quote(4, "A line from an international site.", "https://例え.jp/page"),
      link(5, SAVE_DETAILS_SAVED_URL, {
        metadataTitle: "A page already saved",
        notes: "Saved earlier, with a note.",
        tags: [`scenario-${scenario}`, "design", "reading"],
      }),
      link(6, "https://github.com/acme/design-system", {
        metadataTitle: "A link found on another page",
        sourceTitle: "Where I found it",
        sourceUrl: "https://example.com/where-i-found-it",
      }),
    ],
  };
};

export const OMNIBOX_HIDDEN_TITLE = "Omnibox hidden card";

export const omniboxTitlesPack = (): FolderScenarioPack => {
  const scenario = "omnibox-titles" as const;
  const titled = (
    index: number,
    metadataTitle: string,
    extra: Partial<DevScenarioCardDef> = {}
  ) => {
    const url = `https://omnibox-titles.example/${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", [], extra),
      type: "link" as const,
      content: url,
      url,
      metadataTitle,
    };
  };
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Omnibox plain title", []),
      titled(1, "Omnibox Tom & Jerry"),
      titled(2, "Omnibox <script>alert(1)</script>"),
      titled(3, `Omnibox "double" and 'single' quotes`),
      folderScenarioCard(
        scenario,
        4,
        "Omnibox note: 1 < 2 > 0, saved from a page",
        [],
        { sourceUrl: "https://www.example.com/omnibox-source" }
      ),
      titled(5, longName("Omnibox")),
      titled(6, "Omnibox 🧪🚀 emoji ✨"),
      titled(7, "Omnibox عنوان عربي من اليمين إلى اليسار"),
      titled(8, "Omnibox 東京の小さな喫茶店"),
      titled(9, ""),
      titled(10, OMNIBOX_HIDDEN_TITLE, {
        tags: [`scenario-${scenario}`, "secret"],
      }),
    ],
  };
};

export const OCR_SHARED_KEYWORD = "4411";

export const ocrImagesPack = (): FolderScenarioPack => {
  const scenario = "ocr-images" as const;
  const colors = ["#1f2937", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];
  const image = (
    index: number,
    label: string,
    aiOcrText: string | undefined,
    extra: Partial<DevScenarioCardDef> = {}
  ) => ({
    ...folderScenarioCard(scenario, index, label, []),
    type: "image" as const,
    content: label,
    colors: [{ hex: colors[index % colors.length] as string }],
    fileMetadata: {
      fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      fileSize: 0,
      mimeType: "image/png",
      width: 1600,
      height: index % 3 === 0 ? 2000 : 1000,
    },
    ...(aiOcrText ? { aiOcrText } : {}),
    ...extra,
  });
  const note = (index: number, content: string) =>
    folderScenarioCard(scenario, index, content, []);
  const wall = Array.from(
    { length: 80 },
    (_, line) =>
      `Clause ${line + 1}. The tenant keeps the premises clean and returns every key.`
  )
    .join("\n")
    .slice(0, 4000);
  const images: [string, string | undefined][] = [
    [
      "Receipt ACME",
      `ACME MARKET\nInvoice ${OCR_SHARED_KEYWORD}\nMilk 2.40\nBread 3.10\nTotal due  $5.50`,
    ],
    [
      "Receipt cafe",
      "Café Lumière\nTable 7\n2 × Espresso 6.00\nTOTAL DUE 6.00\nMerci!",
    ],
    [
      "Receipt hardware",
      "BOLT & NUT CO.\nRef 98-221\nHex bolts M6 x 40\nSubtotal 12.80\nVAT 2.56\nTotal 15.36",
    ],
    [
      "Code TypeScript",
      "export const total = (items: Item[]) => {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return sum;\n};",
    ],
    [
      "Code Python",
      "def fizzbuzz(n):\n    for i in range(1, n + 1):\n        if i % 15 == 0:\n            print('FizzBuzz')\n        else:\n            print(i)",
    ],
    [
      "Code terminal",
      "$ bun run test\n 450 pass\n 0 fail\nRan 450 tests across 11 files.",
    ],
    ["Meme one does not simply", "ONE DOES NOT SIMPLY\nSHIP ON A FRIDAY"],
    ["Meme distracted", "MY ROADMAP\nNEW SHINY FRAMEWORK\nME"],
    [
      "Handwritten note",
      "Call mum on Sunday\nbuy stamps\nreturn library books by the 14th",
    ],
    [
      "Whiteboard",
      "Q4 goals:\n1. Search by image text\n2. Faster sync\n3. Fewer bugs",
    ],
    ["Arabic sign", "مرحبا بكم في المكتبة\nالدخول مجاني"],
    ["Hebrew sign", "ברוכים הבאים\nיציאה"],
    ["Japanese station", "東京駅\nTokyo Station\n丸の内北口"],
    ["Japanese menu", "本日のおすすめ\nラーメン ８５０円\n餃子 ４００円"],
    ["Hindi sign", "स्वागत है\nकृपया जूते बाहर उतारें"],
    ["Korean poster", "서울 재즈 페스티벌\n2026년 5월"],
    ["Chinese packaging", "绿茶\n净含量 250克"],
    ["Russian street sign", "Улица Пушкина\nдом 10"],
    ["Mixed Arabic and English", "Exit خروج\nGate 12 البوابة"],
    ["Emoji sticker", "Good vibes only ✨🌈\n#teamteak"],
    ["Wall of text", wall],
    ["Slide deck title", "Why we read the text in images\nTeak · October 2026"],
    ["Book cover", "THE QUIET ROOM\na novel\nMARA ELLISON"],
    ["Street parking sign", "NO PARKING\n8AM – 6PM\nMON–FRI\nTow-away zone"],
    ["Wifi card", "Network: Teak Guest\nAsk the front desk for the code"],
    ["Ticket stub", "ADMIT ONE\nRow F Seat 22\nDoors 19:30"],
    [
      "Error dialog",
      "Something went wrong\nError 0x80070005: Access is denied.\nOK",
    ],
    [
      "Recipe card",
      "Pancakes\n200 g flour\n2 eggs\n300 ml milk\nPinch of salt",
    ],
    ["Map label", "Old Harbour → 400 m\nLighthouse → 1.2 km"],
    ["Price tag", "SALE\n$19.99\nwas $34.99"],
    ["Quote poster", '"Simplicity is the ultimate sophistication."'],
    ["Tiny caption", "fig. 3"],
    ["Photo of a beach", undefined],
    ["Photo of a forest", undefined],
    ["Photo of a cat", undefined],
    ["Abstract gradient", undefined],
    ["Noise only", undefined],
  ];
  const videos: [string, string][] = [
    ["Trailer title card", `Episode ${OCR_SHARED_KEYWORD}\nThe Long Way Home`],
    [
      "Conference talk",
      "Building search that reads images\nSpeaker: A. Rivera",
    ],
    ["Tutorial intro", "How to brew pour-over coffee\nPart 1"],
  ];
  const twins = [
    `Note about invoice ${OCR_SHARED_KEYWORD} for the shop`,
    "Note: total due by Friday",
    "Note on the Tokyo Station meeting point",
    "Note: fizzbuzz interview question",
  ];
  let index = 1;
  const cards = [
    folderScenarioCard(scenario, 0, "OCR images pack", []),
    ...images.map(([label, text]) => image(index++, label, text)),
    ...videos.map(([label, text]) =>
      image(index++, label, text, {
        type: "video",
        fileMetadata: {
          fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`,
          fileSize: 0,
          mimeType: "video/mp4",
          width: 1920,
          height: 1080,
          duration: 30,
        },
      })
    ),
    ...twins.map((content) => note(index++, content)),
  ];
  return { folders: [], cards };
};

export const OCR_LEASE_PHRASE = "lease agreement";

export const ocrDocumentsPack = (): FolderScenarioPack => {
  const scenario = "ocr-documents" as const;
  const pdf = (
    index: number,
    label: string,
    aiOcrText: string | undefined,
    aiSummary: string,
    fileSize = 2_400_000
  ) => ({
    ...folderScenarioCard(scenario, index, label, []),
    type: "document" as const,
    content: "",
    aiSummary,
    aiTags: ["document", "scan"],
    fileMetadata: {
      fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
      fileSize,
      mimeType: "application/pdf",
    },
    ...(aiOcrText ? { aiOcrText } : {}),
  });
  const pages = (...texts: string[]) => texts.join("\n\n");
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "OCR documents pack", []),
      pdf(
        index++,
        "Scanned lease",
        pages(
          "RESIDENTIAL TENANCY\nPrepared for Dana Reyes",
          "LEASE AGREEMENT\nThis lease is made on 1 May 2026 between\nHarbour Homes Ltd (landlord) and Dana Reyes (tenant).",
          "Rent: $1,450 per month, due on the 1st.\nDeposit: $2,900"
        ),
        "A residential lease between Harbour Homes and Dana Reyes, with rent and deposit terms."
      ),
      pdf(
        index++,
        "Board minutes archive 1998",
        pages(
          "MINUTES OF THE BOARD\nVolume 12 · 1998",
          "Present: J. Okafor, M. Lindqvist, R. Patel\nApologies: none",
          "1. The treasurer reported a surplus of 4,210."
        ),
        "The first pages of a 300-page archive of 1998 board minutes.",
        99_000_000
      ),
      pdf(
        index++,
        "Scan with a footer",
        pages(
          "Delivery note 55-1902\nReceived in good condition",
          "Signed: P. Moreau"
        ),
        "A signed delivery note scanned to PDF."
      ),
      pdf(
        index++,
        "Arabic contract scan",
        "عقد إيجار\nالطرف الأول: شركة الميناء\nالإيجار الشهري: ٥٠٠٠",
        "A rental contract in Arabic."
      ),
      pdf(
        index++,
        "Chinese invoice scan",
        "发票\n客户：茶叶有限公司\n金额：￥1,280",
        "An invoice in Chinese for a tea company."
      ),
      pdf(
        index++,
        "Mixed PDF",
        undefined,
        "A report with a text first page; its own text is already searchable."
      ),
      pdf(
        index++,
        "Locked PDF",
        undefined,
        "A password-protected PDF that couldn't be opened."
      ),
      pdf(
        index++,
        "Lease template",
        undefined,
        "A blank lease template with a text layer."
      ),
      folderScenarioCard(
        scenario,
        index++,
        `Note: send the ${OCR_LEASE_PHRASE} to Dana`,
        []
      ),
    ],
  };
};

export const ocrLinksPack = (): FolderScenarioPack => {
  const scenario = "ocr-links" as const;
  const link = (
    index: number,
    url: string,
    title: string,
    aiOcrText: string | undefined
  ) => {
    const markedUrl = `${url}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", []),
      type: "link" as const,
      content: markedUrl,
      url: markedUrl,
      metadataTitle: title,
      metadata: {
        linkPreview: {
          source: "scenario",
          status: "success",
          fetchedAt: Date.UTC(2026, 9, 1),
          url: markedUrl,
          finalUrl: markedUrl,
          title,
        } as never,
      },
      ...(aiOcrText ? { aiOcrText } : {}),
    };
  };
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "OCR links pack", []),
      link(
        index++,
        "https://example.com/talks/postgres",
        "Conference talk recording",
        "SCALING POSTGRES\nto a million users\nA. Rivera · Data Day 2026"
      ),
      link(
        index++,
        "https://docs.example.com/getting-started",
        "Getting started",
        "Docs › Getting started\nInstall the CLI\nnpm install -g teak-cli"
      ),
      link(
        index++,
        "https://blog.example.com/fast-json",
        "Parsing JSON faster",
        "for (const byte of buffer) {\n  if (byte === QUOTE) inString = !inString;\n}"
      ),
      link(
        index++,
        "https://news.example.com/ar/harbour",
        "أخبار الميناء",
        "افتتاح الميناء الجديد\nالأحد ١٢ أكتوبر"
      ),
      link(
        index++,
        "https://app.example.com/dashboard",
        "Single-page app",
        undefined
      ),
      folderScenarioCard(
        scenario,
        index++,
        "Note: watch the scaling postgres talk",
        []
      ),
    ],
  };
};

const DONE_STATES_DONE_AT = Date.UTC(2026, 9, 10);

export const doneStatesPack = (): FolderScenarioPack => {
  const scenario = "done-states" as const;
  const link = (
    index: number,
    title: string,
    category: LinkCategory | undefined,
    extra: Partial<DevScenarioCardDef> = {},
    folders: number[] = []
  ) => {
    const url = `https://example.com/${scenario}/${index}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...folderScenarioCard(scenario, index, "", folders, extra),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
      ...(category
        ? {
            metadata: {
              linkCategory: {
                category,
                fetchedAt: Date.UTC(2026, 9, 1),
                sourceUrl: url,
              },
            },
          }
        : {}),
    };
  };
  const done = { completedAt: DONE_STATES_DONE_AT };
  let index = 1;
  return {
    folders: [
      { name: "Reading list", color: "blue" },
      {
        name: "Left to read",
        color: "green",
        query: 'is:todo folder:"Reading list"',
      },
    ],
    cards: [
      folderScenarioCard(scenario, 0, "Done states pack", []),
      ...LINK_CATEGORIES.map((category, position) =>
        link(
          index++,
          `A ${category.replace("_", " ")} link${position % 2 ? " (done)" : ""}`,
          category,
          position % 2 ? done : {},
          category === "article" || category === "book" ? [0] : []
        )
      ),
      link(index++, "A done article in Trash", "article", {
        ...done,
        isDeleted: true,
      }),
      link(index++, "A done film in Archive", "movie", {
        ...done,
        isArchived: true,
      }),
      link(index++, "A link still being read", undefined),
      link(index++, "x".repeat(300), "book", done),
      link(index++, "مقالة مقروءة عن تصميم الخطوط", "article", done),
      link(index++, "読み終えた長編小説の感想", "book", done),
    ],
  };
};
export const CHECKLIST_LONG_ITEMS = 200;

export const checklistsPack = (): FolderScenarioPack => {
  const scenario = "checklists" as const;
  const note = (index: number, content: string) =>
    folderScenarioCard(scenario, index, content, []);
  const tasks = (count: number, label: string) =>
    Array.from(
      { length: count },
      (_, i) => `- [ ] ${label} ${String(i + 1).padStart(3, "0")}`
    ).join("\n");
  const nested = [0, 1, 2, 3, 4]
    .flatMap((depth) => {
      const indent = "  ".repeat(depth);
      return [
        `${indent}- [ ] Level ${depth + 1} first`,
        `${indent}- [ ] Level ${depth + 1} second`,
      ];
    })
    .join("\n");
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Checklists pack", []),
      note(1, `# Packing list\n\n${tasks(10, "Pack item")}`),
      note(2, `# Long checklist\n\n${tasks(CHECKLIST_LONG_ITEMS, "Step")}`),
      note(3, `# Nested checklist\n\n${nested}`),
      note(
        4,
        "# Mixed lists\n\n- A plain bullet\n- Another bullet\n\nThen the tasks:\n\n- [ ] Open task\n- [ ] Second task\n- [x] Done task"
      ),
      note(
        5,
        "# All done\n\n- [x] Wrote it\n- [x] Checked it\n- [x] Shipped it"
      ),
      note(
        6,
        "# Odd spacing\n\n-  [ ] Two spaces\n\n- [ ] Blank line above\n* [ ] Star bullet"
      ),
      note(
        7,
        "# Quoted checklist\n\n> - [ ] Quoted first\n> - [ ] Quoted second"
      ),
      note(
        8,
        "# Checklist with a table\n\n| Task | Owner |\n| --- | --- |\n| Review | Web |\n\n- [ ] Table note first\n- [ ] Table note second"
      ),
    ],
  };
};

export const hiddenMixPack = (): FolderScenarioPack => {
  const scenario = "hidden-mix" as const;
  const tagged = (...tags: string[]) => ({
    tags: [`scenario-${scenario}`, ...tags],
  });
  const card = (
    index: number,
    label: string,
    folders: number[],
    extra: Partial<DevScenarioCardDef> = {}
  ) => folderScenarioCard(scenario, index, label, folders, extra);
  const hostLink = (index: number, title: string, tags: string[]) => {
    const url = `https://hidden-mix.example/${index}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return {
      ...card(index, "", [], tagged(...tags)),
      type: "link" as const,
      content: url,
      url,
      metadataTitle: title,
    };
  };
  return {
    folders: [
      { name: "Hidden mix folder", color: "violet" },
      { name: "Hidden mix smart", query: `tag:scenario-${scenario}` },
      {
        name: "Hidden mix secret",
        color: "gray",
        query: `#secret tag:scenario-${scenario}`,
      },
    ],
    cards: [
      card(0, "Hidden mix pack", []),
      card(1, "Hidden: tagged Secret", [], tagged("Secret")),
      card(
        2,
        "Hidden: tagged HIDDEN with a trailing space",
        [],
        tagged("HIDDEN ")
      ),
      card(
        3,
        "Hidden: tagged hidden with a leading space",
        [],
        tagged(" hidden")
      ),
      card(4, "Hidden: a favorite", [], {
        ...tagged("secret"),
        isFavorited: true,
      }),
      card(5, "Hidden: archived", [], {
        ...tagged("secret"),
        isArchived: true,
      }),
      card(6, "Hidden: in Trash", [], {
        ...tagged("secret"),
        isDeleted: true,
      }),
      card(7, "Hidden: in a folder", [0], tagged("secret")),
      hostLink(8, "Hidden: a link on hidden-mix.example", ["secret"]),
      card(9, "Shown: hidden is only an AI tag", [], { aiTags: ["hidden"] }),
      card(10, "Shown: in the folder", [0]),
      hostLink(11, "Shown: a link on hidden-mix.example", []),
    ],
  };
};

export const REVISIT_SIZE_GROUPS = [0, 1, 19, 20, 21] as const;

const REVISIT_START = Date.UTC(2019, 2, 1);
const REVISIT_SHAPES = [
  "text",
  "quote",
  "link",
  "palette",
  "image",
  "very tall image",
  "video",
  "audio",
  "document",
  "long title",
] as const;

const revisitCard = (
  shape: (typeof REVISIT_SHAPES)[number],
  label: string
): Partial<DevScenarioCardDef> &
  Pick<DevScenarioCardDef, "content" | "type"> => {
  const color = { hex: "#4d96ff" };
  const file = (
    fileName: string,
    mimeType: string,
    size: { duration?: number; height?: number; width?: number }
  ) => ({ fileMetadata: { fileName, fileSize: 0, mimeType, ...size } });
  switch (shape) {
    case "quote":
      return { type: "quote", content: `${label}: keep what still matters.` };
    case "link": {
      const url = `https://revisit.example/${encodeURIComponent(label)}`;
      return { type: "link", content: url, url, metadataTitle: label };
    }
    case "palette":
      return {
        type: "palette",
        content: label,
        colors: [{ hex: "#ff6b6b" }, { hex: "#ffd93d" }, { hex: "#6bcb77" }],
      };
    case "image":
      return {
        type: "image",
        content: label,
        colors: [color],
        ...file(`${label}.png`, "image/png", { width: 1600, height: 1000 }),
      };
    case "very tall image":
      return {
        type: "image",
        content: label,
        colors: [{ hex: "#6bcb77" }],
        ...file(`${label}.png`, "image/png", { width: 400, height: 2400 }),
      };
    case "video":
      return {
        type: "video",
        content: label,
        metadataTitle: `${label}.mp4`,
        ...file(`${label}.mp4`, "video/mp4", {
          width: 1920,
          height: 1080,
          duration: 12,
        }),
      };
    case "audio":
      return {
        type: "audio",
        content: label,
        metadataTitle: `${label}.m4a`,
        fileMetadata: {
          ...file(`${label}.m4a`, "audio/mp4", { duration: 17.8 }).fileMetadata,
          waveform: AUDIO_WAVEFORM,
        },
      };
    case "document":
      return {
        type: "document",
        content: label,
        ...file(`${label}.pdf`, "application/pdf", {}),
      };
    case "long title":
      return {
        type: "text",
        content:
          `${label} ${"a very long first line that keeps going ".repeat(8)}`.slice(
            0,
            300
          ),
      };
    default:
      return { type: "text", content: `${label}\nA note saved years ago.` };
  }
};

export const revisitSizesPack = (): FolderScenarioPack => {
  const scenario = "revisit-sizes" as const;
  const cards: FolderScenarioCard[] = [
    folderScenarioCard(scenario, 0, "Revisit sizes pack", []),
  ];
  let index = 1;
  for (const size of REVISIT_SIZE_GROUPS) {
    const tag = `rv${size}`;
    for (let position = 1; position <= size; position += 1) {
      const shape =
        REVISIT_SHAPES[(position - 1) % REVISIT_SHAPES.length] ?? "text";
      cards.push({
        ...revisitCard(shape, `${tag} ${position} of ${size} (${shape})`),
        createdAt: REVISIT_START + index * 86_400_000 * 11,
        folders: [],
        tags: [`scenario-${scenario}`, tag],
      });
      index += 1;
    }
    cards.push({
      type: "text",
      content: `${tag} hidden: Revisit must never deal this card`,
      createdAt: REVISIT_START + index * 86_400_000 * 11,
      folders: [],
      tags: [`scenario-${scenario}`, tag, "secret"],
    });
    index += 1;
  }
  return { folders: [], cards };
};
