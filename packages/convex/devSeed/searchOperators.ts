import type { DevScenarioCardDef } from "../card/defaultCards";
import {
  type FolderScenarioCard,
  type FolderScenarioPack,
  folderScenarioCard,
} from "./folderPacks";
import { SCENARIO_MARKER } from "./helpers";

const scenario = "search-operators" as const;
const SCOPE = `tag:scenario-${scenario}`;

export const SEARCH_OPERATOR_COUNTS = {
  designNotes: 60,
  figmaNotes: 30,
  brandGuides: 10,
  fonts: 20,
  type: 20,
  fontsCaseVariant: 10,
  fontsAndType: 5,
  inspoImages: 40,
  inspoLinks: 20,
  github: 30,
  gitlab: 20,
  codeberg: 10,
  hidden: 10,
  inbox: 20,
  readingList: 20,
  inBoth: 5,
  products: 20,
  receipts: 10,
  receiptNotes: 5,
} as const;

export const SEARCH_OPERATOR_ARCHIVED = { github: 6, gitlab: 4 } as const;

export const SEARCH_OPERATOR_TOTAL = 400;

/**
 * 400 cards where each operator has its own answer: "design" with and without
 * "figma", the tags fonts, type and Fonts, images and links on github.com and
 * gitlab.com (some archived), hidden cards, cards in "Inbox" and "Reading
 * list", priced products and receipts reading "total due", plus smart folders
 * with an OR, an exclusion and a group.
 */
export const searchOperatorsPack = (): FolderScenarioPack => {
  const cards: FolderScenarioCard[] = [
    folderScenarioCard(scenario, 0, "Search operators pack", []),
  ];
  const add = (
    label: string,
    tags: string[],
    extra: Partial<DevScenarioCardDef> = {},
    folders: number[] = []
  ) => {
    const index = cards.length;
    // Applied after the base card, which would set a text card's type.
    cards.push({
      ...folderScenarioCard(scenario, index, label, folders),
      ...extra,
      tags: [`scenario-${scenario}`, ...tags],
    });
    return index;
  };
  const link = (
    host: string,
    title: string,
    tags: string[],
    extra: Partial<DevScenarioCardDef> = {}
  ) => {
    const index = cards.length;
    const url = `https://${host}/teak-operators/${index}#${SCENARIO_MARKER}-${scenario}-${index}`;
    return add("", tags, {
      ...extra,
      type: "link",
      content: url,
      url,
      metadataTitle: title,
    });
  };
  const image = (
    label: string,
    tags: string[],
    extra: Partial<DevScenarioCardDef> = {}
  ) =>
    add(label, tags, {
      ...extra,
      type: "image",
      content: label,
      fileMetadata: {
        fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
        fileSize: 0,
        mimeType: "image/png",
        width: 1600,
        height: 1000,
      },
    });
  const repeat = (count: number, each: (n: number) => void) => {
    for (let n = 1; n <= count; n += 1) {
      each(n);
    }
  };
  const counts = SEARCH_OPERATOR_COUNTS;

  repeat(counts.designNotes, (n) => add(`Design notes ${n}`, []));
  repeat(counts.figmaNotes, (n) => add(`Design in Figma ${n}`, []));
  repeat(counts.brandGuides, (n) => add(`Our brand guide, part ${n}`, []));
  repeat(counts.fonts, (n) => add(`Font pairing ${n}`, ["fonts"]));
  repeat(counts.type, (n) => add(`Type specimen ${n}`, ["type"]));
  repeat(counts.fontsCaseVariant, (n) => add(`Font scan ${n}`, ["Fonts"]));
  repeat(counts.fontsAndType, (n) =>
    add(`Font and type ${n}`, ["fonts", "type"])
  );
  repeat(counts.inspoImages, (n) => image(`Inspo image ${n}`, ["inspo"]));
  repeat(counts.inspoLinks, (n) =>
    link("inspo.example", `Inspo link ${n}`, ["inspo"])
  );
  repeat(counts.github, (n) =>
    link(
      "github.com",
      `GitHub repo ${n}`,
      [],
      n <= SEARCH_OPERATOR_ARCHIVED.github ? { isArchived: true } : {}
    )
  );
  repeat(counts.gitlab, (n) =>
    link(
      "gitlab.com",
      `GitLab repo ${n}`,
      [],
      n <= SEARCH_OPERATOR_ARCHIVED.gitlab ? { isArchived: true } : {}
    )
  );
  repeat(counts.codeberg, (n) =>
    link("codeberg.org", `Codeberg repo ${n}`, [])
  );
  repeat(counts.hidden, (n) =>
    add(
      `Hidden design diary ${n}`,
      n % 2 === 0 ? ["hidden", "fonts"] : ["hidden"]
    )
  );
  repeat(counts.inbox, (n) => add(`Inbox item ${n}`, [], {}, [0]));
  repeat(counts.readingList, (n) => add(`Reading item ${n}`, [], {}, [1]));
  repeat(counts.inBoth, (n) => add(`Inbox and reading ${n}`, [], {}, [0, 1]));
  repeat(counts.products, (n) => {
    const amount = n * 20;
    link("shop.example", `Desk lamp ${n} for ${amount}`, ["product"], {
      metadata: {
        linkCategory: {
          category: "product",
          fetchedAt: Date.UTC(2026, 9, 1),
          sourceUrl: `https://shop.example/teak-operators/${cards.length}`,
          price: { amount, currency: "USD" },
        },
      },
    });
  });
  repeat(counts.receipts, (n) =>
    image(`Receipt ${n}`, [], { aiOcrText: `Order ${n}\nTOTAL DUE $${n}0` })
  );
  repeat(counts.receiptNotes, (n) =>
    add(`Remember the total due on bill ${n}`, [])
  );
  let misc = 1;
  while (cards.length < SEARCH_OPERATOR_TOTAL) {
    add(`Misc note ${misc}`, ["misc"]);
    misc += 1;
  }

  return {
    folders: [
      { name: "Inbox", color: "gray" },
      { name: "Reading list", color: "blue" },
      {
        name: "Fonts or type",
        color: "violet",
        query: `${SCOPE} (tag:fonts OR tag:type)`,
      },
      {
        name: "Operators, not archived",
        color: "green",
        query: `${SCOPE} -is:archived`,
      },
      {
        name: "GitHub or GitLab",
        color: "orange",
        query: `${SCOPE} (site:github.com OR site:gitlab.com)`,
      },
    ],
    cards,
  };
};
