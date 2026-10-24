import type { FolderScenarioCard, FolderScenarioPack } from "./folderPacks";
import { SCENARIO_MARKER } from "./helpers";

const DAY = 86_400_000;
const TAG = "scenario-ordering-saved";
export const ORDERING_SAVED_FOLDER = "Saved again";
export const ORDERING_SAVED_HOST = "ordering-saved.example.com";

/**
 * Each card's first save and last save, in days before the pack is seeded.
 * `saved` is missing on a card never saved again. Ordered by `createdAt` the
 * library reads Two days, Last month, Resaved, Two years; ordered by
 * `savedAt` it reads Resaved, Two days, Last month, Two years.
 */
export const ORDERING_SAVED_CARDS: {
  label: string;
  created: number;
  saved?: number;
  link?: string;
  archived?: true;
  trashed?: true;
  favorite?: true;
}[] = [
  {
    label: "Resaved: first saved 400 days ago, saved again yesterday",
    created: 400,
    saved: 1,
    link: `https://${ORDERING_SAVED_HOST}/resaved#${SCENARIO_MARKER}-ordering-saved`,
    favorite: true,
  },
  {
    label: "Two days: saved 2 days ago, never again",
    created: 2,
    link: `https://${ORDERING_SAVED_HOST}/two-days`,
  },
  {
    label: "Last month: saved 30 days ago, never again",
    created: 30,
    favorite: true,
  },
  {
    label: "Two years: saved 730 days ago, never again",
    created: 730,
    link: `https://${ORDERING_SAVED_HOST}/two-years`,
    favorite: true,
  },
  {
    label: "Archived: first saved 500 days ago, saved again 3 days ago",
    created: 500,
    saved: 3,
    link: `https://${ORDERING_SAVED_HOST}/archived`,
    archived: true,
    favorite: true,
  },
  {
    label: "Archived: saved 10 days ago, never again",
    created: 10,
    archived: true,
  },
  {
    label: "In Trash: first saved 600 days ago, saved again 5 days ago",
    created: 600,
    saved: 5,
    trashed: true,
  },
];

/**
 * Cards whose `savedAt` and `createdAt` disagree, all in one folder, tagged
 * and (the links) on one site, so "Newest first", "Oldest first", date words
 * and folder, tag, site and favorites lists each show the saved order.
 * Dates are relative to when it is seeded, so "last week" stays meaningful.
 */
export const orderingSavedPack = (now = Date.now()): FolderScenarioPack => ({
  folders: [{ name: ORDERING_SAVED_FOLDER }],
  cards: ORDERING_SAVED_CARDS.map((card): FolderScenarioCard => {
    const createdAt = now - card.created * DAY;
    const base = {
      createdAt,
      ...(card.saved === undefined ? {} : { savedAt: now - card.saved * DAY }),
      tags: [TAG],
      folders: [0],
      ...(card.archived ? { isArchived: true } : {}),
      ...(card.trashed ? { isDeleted: true } : {}),
      ...(card.favorite ? { isFavorited: true } : {}),
    };
    return card.link
      ? {
          ...base,
          type: "link",
          content: card.link,
          url: card.link,
          metadataTitle: card.label,
          notes: card.label,
        }
      : { ...base, type: "text", content: card.label };
  }),
});
