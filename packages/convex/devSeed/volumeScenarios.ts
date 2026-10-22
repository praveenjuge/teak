import type { DevScenarioCardDef } from "../card/defaultCards";
import { FOLDER_SCENARIO_START } from "./folderPacks";
import { palette, SCENARIO_MARKER } from "./helpers";

export const ORDERING_SCENARIO_SIZE = 1000;
export const ORDERING_SCENARIO_PAGE_SIZE = 200;
const ORDERING_START = Date.UTC(2016, 0, 1);
const ORDERING_SPAN = Date.UTC(2026, 0, 1) - ORDERING_START;
const ORDERING_TYPES = ["text", "quote", "link", "palette"] as const;

const orderingIndexAt = (position: number) =>
  (position * 389) % ORDERING_SCENARIO_SIZE;

const orderingHex = (seed: number) =>
  `#${(Math.floor(((seed + 1) * 2_654_435_761) / 256) % 0x1_00_00_00)
    .toString(16)
    .padStart(6, "0")}`;

export const orderingScenarioCard = (position: number): DevScenarioCardDef => {
  const index = orderingIndexAt(position);
  const createdAt =
    ORDERING_START +
    Math.floor((index / ORDERING_SCENARIO_SIZE) * ORDERING_SPAN);
  const label = `#${String(index).padStart(4, "0")} saved ${new Date(createdAt).toISOString().slice(0, 10)}`;
  const type = ORDERING_TYPES[index % ORDERING_TYPES.length];
  const base = {
    createdAt,
    tags: ["scenario-ordering"],
    isFavorited: index % 7 === 0 || undefined,
    isDeleted: index % 50 === 0 || undefined,
  };
  if (type === "link") {
    const url = `https://example.com/ordering/${index}#${SCENARIO_MARKER}-ordering`;
    return {
      ...base,
      type,
      content: url,
      url,
      metadataTitle: `Link ${label}`,
    };
  }
  if (type === "palette") {
    return {
      ...base,
      ...palette(`Palette ${label}`, [
        orderingHex(index),
        orderingHex(index + 500),
      ]),
    };
  }
  return {
    ...base,
    type,
    content: type === "quote" ? `"Quote ${label}"` : `Note ${label}`,
  };
};

export const orderingScenarioPage = (page: number): DevScenarioCardDef[] => {
  const start = page * ORDERING_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ORDERING_SCENARIO_PAGE_SIZE,
    ORDERING_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    orderingScenarioCard(start + offset)
  );
};

export const ARCHIVE_MIX_SCENARIO_SIZE = 1000;
export const ARCHIVE_MIX_SCENARIO_PAGE_SIZE = 200;
const ARCHIVE_MIX_START = Date.UTC(2025, 0, 1);

export const archiveMixScenarioCard = (index: number): DevScenarioCardDef => {
  const isArchived = index % 5 === 0;
  const isDeleted = index % 10 === 3 || index % 50 === 0;
  const isFavorited = index % 7 === 0;
  let state = "active";
  if (isArchived && isDeleted) {
    state = "archived, in Trash";
  } else if (isArchived) {
    state = "archived";
  } else if (isDeleted) {
    state = "in Trash";
  }
  const label = `Mix #${String(index).padStart(4, "0")} ${state}${isFavorited ? ", favorite" : ""}`;
  const base = {
    createdAt: ARCHIVE_MIX_START + index * 3_600_000,
    tags: ["scenario-archive", index % 2 === 0 ? "Moodboard" : "moodboard"],
    isArchived: isArchived || undefined,
    isDeleted: isDeleted || undefined,
    isFavorited: isFavorited || undefined,
  };
  const type = ORDERING_TYPES[index % ORDERING_TYPES.length];
  if (type === "link") {
    const url = `https://example.com/archive-mix/${index}#${SCENARIO_MARKER}-archive`;
    return { ...base, type, content: url, url, metadataTitle: label };
  }
  if (type === "palette") {
    return {
      ...base,
      ...palette(label, [orderingHex(index), orderingHex(index + 500)]),
    };
  }
  return {
    ...base,
    type,
    content: type === "quote" ? `"${label}"` : label,
  };
};

export const archiveMixScenarioPage = (page: number): DevScenarioCardDef[] => {
  const start = page * ARCHIVE_MIX_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ARCHIVE_MIX_SCENARIO_PAGE_SIZE,
    ARCHIVE_MIX_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    archiveMixScenarioCard(start + offset)
  );
};

export const TAGS_2000_SCENARIO_SIZE = 1000;
export const TAGS_2000_SCENARIO_PAGE_SIZE = 200;
const TAGS_2000_START = Date.UTC(2025, 6, 1);

export const tags2000ScenarioCard = (index: number): DevScenarioCardDef => {
  const topic = (n: number) => `topic-${String(n).padStart(4, "0")}`;
  const tags = [topic(index * 2), topic(index * 2 + 1)];
  if (index % 2 === 0) {
    tags.push("design");
  }
  if (index % 3 === 0) {
    tags.push("reference");
  }
  if (index % 5 === 0) {
    tags.push("inspiration");
  }
  const label = `Tagged #${String(index).padStart(4, "0")}`;
  const base = { createdAt: TAGS_2000_START + index * 3_600_000, tags };
  if (index % 4 === 0) {
    const url = `https://example.com/tags-2000/${index}#${SCENARIO_MARKER}-tags-2000`;
    return { ...base, type: "link", content: url, url, metadataTitle: label };
  }
  return { ...base, type: "text", content: label };
};

export const tags2000ScenarioPage = (page: number): DevScenarioCardDef[] => {
  const start = page * TAGS_2000_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + TAGS_2000_SCENARIO_PAGE_SIZE,
    TAGS_2000_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    tags2000ScenarioCard(start + offset)
  );
};

export const DONE_STATES_IMAGES_SIZE = 1000;
const DONE_STATES_IMAGES_PAGE_SIZE = 200;

export const doneStatesImagesPage = (page: number): DevScenarioCardDef[] => {
  const start = page * DONE_STATES_IMAGES_PAGE_SIZE;
  const end = Math.min(
    start + DONE_STATES_IMAGES_PAGE_SIZE,
    DONE_STATES_IMAGES_SIZE
  );
  if (end <= start) {
    return [];
  }
  const marker = `https://example.com/done-states-images#${SCENARIO_MARKER}-${page}`;
  const images = Array.from({ length: end - start }, (_, offset) => {
    const index = start + offset;
    return {
      type: "image" as const,
      content: `Image ${String(index).padStart(4, "0")}`,
      createdAt: FOLDER_SCENARIO_START + index * 60_000,
      tags: ["scenario-done-states-images"],
      colors: [{ hex: index % 2 ? "#3b82f6" : "#f59e0b" }],
      fileMetadata: {
        fileName: `done-states-${index}.png`,
        fileSize: 0,
        mimeType: "image/png",
        width: 1200,
        height: 900,
      },
    };
  });
  return [
    {
      type: "link",
      content: marker,
      url: marker,
      metadataTitle: `Done states images, page ${page + 1}`,
      tags: ["scenario-done-states-images"],
    },
    ...images,
  ];
};

export const HIDDEN_MIX_VOLUME_SIZE = ORDERING_SCENARIO_SIZE;

export const hiddenMixVolumeCard = (position: number): DevScenarioCardDef => {
  const ordering = orderingScenarioCard(position);
  const index = orderingIndexAt(position);
  const hidden = index % 5 === 0;
  return {
    ...ordering,
    ...(ordering.url
      ? {
          url: ordering.url.replace("/ordering/", "/hidden-mix-1000/"),
          content: ordering.url.replace("/ordering/", "/hidden-mix-1000/"),
        }
      : {}),
    tags: ["scenario-hidden-mix-1000", ...(hidden ? ["secret"] : [])],
  };
};

export const hiddenMixVolumePage = (page: number): DevScenarioCardDef[] => {
  const start = page * ORDERING_SCENARIO_PAGE_SIZE;
  const end = Math.min(
    start + ORDERING_SCENARIO_PAGE_SIZE,
    HIDDEN_MIX_VOLUME_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    hiddenMixVolumeCard(start + offset)
  );
};

export const SEARCH_QUALIFIERS_VOLUME_SIZE = 1000;
export const SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE = 200;
const SEARCH_QUALIFIERS_VOLUME_START = Date.UTC(2024, 0, 1);
const VOLUME_RARE_HOSTS = [
  "github.com",
  "www.figma.com",
  "例え.jp",
  "blog.example.com",
] as const;

export const searchQualifiersVolumeCard = (
  index: number
): DevScenarioCardDef => {
  const host =
    index % 10 === 0
      ? VOLUME_RARE_HOSTS[(index / 10) % VOLUME_RARE_HOSTS.length]
      : "noise.example";
  const url = `https://${host}/volume/${index}#${SCENARIO_MARKER}-search-qualifiers-1000`;
  return {
    type: "link",
    content: url,
    url,
    metadataTitle: `Volume #${String(index).padStart(4, "0")} on ${host}`,
    createdAt: SEARCH_QUALIFIERS_VOLUME_START + index * 3_600_000,
    tags: [
      "scenario-search-qualifiers-1000",
      ...(index % 3 === 0 ? ["design"] : []),
    ],
    ...(index % 9 === 0 ? { isFavorited: true } : {}),
    ...(index % 13 === 0 ? { isArchived: true } : {}),
  };
};

export const searchQualifiersVolumePage = (
  page: number
): DevScenarioCardDef[] => {
  const start = page * SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE;
  const end = Math.min(
    start + SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE,
    SEARCH_QUALIFIERS_VOLUME_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    searchQualifiersVolumeCard(start + offset)
  );
};

const KEYBOARD_MIXED_START = Date.UTC(2026, 9, 1);
const KEYBOARD_MIXED_SHAPES = [
  "tall",
  "palette",
  "short",
  "wide",
  "quote",
  "link",
  "very tall",
  "short",
] as const;
const KEYBOARD_MIXED_COLORS = [
  "#1f6feb",
  "#d97706",
  "#059669",
  "#be185d",
  "#7c3aed",
  "#0f766e",
];

export const keyboardMixedScenarioCard = (
  index: number
): DevScenarioCardDef => {
  const shape = KEYBOARD_MIXED_SHAPES[index % KEYBOARD_MIXED_SHAPES.length];
  const label = `Keyboard mix #${String(index).padStart(2, "0")} ${shape}`;
  const color =
    KEYBOARD_MIXED_COLORS[index % KEYBOARD_MIXED_COLORS.length] ?? "#1f6feb";
  const base = {
    createdAt: KEYBOARD_MIXED_START + index * 60_000,
    tags: ["scenario-keyboard-mixed"],
  };
  const block = (width: number, height: number): DevScenarioCardDef => ({
    ...base,
    type: "image",
    content: label,
    colors: [{ hex: color }],
    fileMetadata: {
      fileName: `keyboard-mix-${String(index).padStart(2, "0")}.png`,
      fileSize: 0,
      mimeType: "image/png",
      width,
      height,
    },
  });
  switch (shape) {
    case "tall":
      return block(600, 1200);
    case "very tall":
      return block(400, 1400);
    case "wide":
      return block(1600, 600);
    case "palette":
      return { ...base, ...palette(label, [color, "#f5f5f4", "#1c1917"]) };
    case "quote":
      return { ...base, type: "quote", content: `"${label}"` };
    case "link": {
      const url = `https://example.com/keyboard-mixed/${index}#${SCENARIO_MARKER}-keyboard-mixed-${index}`;
      return { ...base, type: "link", content: url, url, metadataTitle: label };
    }
    default:
      return { ...base, type: "text", content: label };
  }
};

export const KEYBOARD_MIXED_SCENARIO_SIZE = 48;

export const SHUFFLE_PARTIAL_SCENARIO_SIZE = 400;
const SHUFFLE_PARTIAL_PAGE_SIZE = 200;
const SHUFFLE_PARTIAL_START = Date.UTC(2024, 0, 1);
const SHUFFLE_PARTIAL_TYPES = ["text", "quote", "palette"] as const;

export const shufflePartialScenarioCard = (
  index: number
): DevScenarioCardDef => {
  const keyed = index % 4 === 0;
  const label = `Shuffle #${String(index).padStart(3, "0")} ${
    keyed ? "keyed" : "no key"
  }`;
  const base = {
    createdAt: SHUFFLE_PARTIAL_START + index * 86_400_000,
    tags: ["scenario-shuffle-partial"],
    shuffleKey: keyed ? undefined : null,
  };
  if (index % SHUFFLE_PARTIAL_PAGE_SIZE === 0) {
    const url = `https://example.com/shuffle-partial/${index}#${SCENARIO_MARKER}-shuffle-partial-${index}`;
    return { ...base, type: "link", content: url, url, metadataTitle: label };
  }
  const type = SHUFFLE_PARTIAL_TYPES[index % SHUFFLE_PARTIAL_TYPES.length];
  if (type === "palette") {
    return { ...base, ...palette(label, ["#0f766e", "#f5f5f4", "#1c1917"]) };
  }
  return {
    ...base,
    type,
    content: type === "quote" ? `"${label}"` : label,
  };
};

export const shufflePartialScenarioPage = (
  page: number
): DevScenarioCardDef[] => {
  const start = page * SHUFFLE_PARTIAL_PAGE_SIZE;
  const end = Math.min(
    start + SHUFFLE_PARTIAL_PAGE_SIZE,
    SHUFFLE_PARTIAL_SCENARIO_SIZE
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
    shufflePartialScenarioCard(start + offset)
  );
};
