import type { DevScenarioCardDef } from "../card/defaultCards";
import type { FolderScenarioCard, FolderScenarioPack } from "./folderPacks";

const TAG = "scenario-resave";
const DAY = 86_400_000;
const START = Date.UTC(2023, 9, 1);
const SPAN = 3 * 365 * DAY;

export const RESAVE_LINK_COUNT = 300;
/** Every 15th of the 300 links is archived. */
export const RESAVE_ARCHIVED_EVERY = 15;
export const RESAVE_TRASHED_COUNT = 5;
export const RESAVE_FOLDERS = [
  "Resave reading A",
  "Resave reading B",
  "Resave reading C",
];
/** In all three folders and tagged `reading`, saved two years ago. */
export const RESAVE_READING_URL = "https://example.com/resave/reading";
/** Saved with a tracking parameter; saving the bare link moves it. */
export const RESAVE_UTM_URL =
  "https://example.com/resave/utm-variant?utm_source=newsletter";

/** The link of the `n`th of the 300 cards, 1 being the oldest. */
export const resaveLinkUrl = (n: number) =>
  `https://example.com/resave/${String(n).padStart(3, "0")}`;

const link = (
  url: string,
  title: string,
  createdAt: number,
  extra: Partial<FolderScenarioCard> = {}
): FolderScenarioCard => ({
  type: "link",
  content: url,
  url,
  metadataTitle: title,
  createdAt,
  tags: [TAG],
  folders: [],
  ...extra,
});

/**
 * Links to save again: 300 spread over three years with known keys (every
 * 15th archived), five in Trash only (saving one makes a new card), one in
 * three folders and tagged `reading`, and one saved with `utm_source`.
 */
export const resavePack = (): FolderScenarioPack => {
  const step = Math.floor(SPAN / RESAVE_LINK_COUNT);
  const cards: FolderScenarioCard[] = [
    link(
      RESAVE_READING_URL,
      "Resave: in three folders, tagged reading",
      START + 365 * DAY,
      { folders: [0, 1, 2], tags: [TAG, "reading"] }
    ),
    link(RESAVE_UTM_URL, "Resave: saved with utm_source", START + 400 * DAY),
  ];
  for (let n = 1; n <= RESAVE_LINK_COUNT; n += 1) {
    const archived = n % RESAVE_ARCHIVED_EVERY === 0;
    cards.push(
      link(
        resaveLinkUrl(n),
        `Resave link ${String(n).padStart(3, "0")}${archived ? " (archived)" : ""}`,
        START + (n - 1) * step,
        archived ? { isArchived: true } : {}
      )
    );
  }
  for (let n = 1; n <= RESAVE_TRASHED_COUNT; n += 1) {
    cards.push(
      link(
        `https://example.com/resave/trashed-${n}`,
        `Resave: in Trash ${n}`,
        START + (500 + n) * DAY,
        { isDeleted: true }
      )
    );
  }
  return {
    cards,
    folders: RESAVE_FOLDERS.map((name) => ({ name, color: "teal" as const })),
  };
};

/** The links a free account at the card limit has to save again. */
export const RESAVE_AT_LIMIT_LINKS: DevScenarioCardDef[] = [1, 2, 3, 4, 5].map(
  (n) => ({
    type: "link",
    content: `https://example.com/resave-limit/${n}`,
    url: `https://example.com/resave-limit/${n}`,
    metadataTitle: `At the limit ${n}${n === 5 ? " (archived)" : ""}`,
    createdAt: START + n * DAY,
    tags: ["scenario-resave-at-limit"],
    ...(n === 5 ? { isArchived: true } : {}),
  })
);
