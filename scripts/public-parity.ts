export interface IntentionalGap {
  none: string;
}

export type Surface = readonly string[] | IntentionalGap;

export interface PublicParityRow {
  cli: Surface;
  feature: string;
  mcp: Surface;
  operationId: string;
  sdk: Surface;
}

const INFRASTRUCTURE: IntentionalGap = {
  none: "infrastructure endpoint for monitors and API clients, not a feature",
};
const NO_AGENT_EXPORTS: IntentionalGap = {
  none: "a full-account ZIP is for people; agents read cards one page at a time",
};

export const PUBLIC_PARITY: readonly PublicParityRow[] = [
  {
    operationId: "getHealth",
    feature: "Health check",
    mcp: INFRASTRUCTURE,
    sdk: INFRASTRUCTURE,
    cli: INFRASTRUCTURE,
  },
  {
    operationId: "getApiDiscovery",
    feature: "API discovery",
    mcp: INFRASTRUCTURE,
    sdk: INFRASTRUCTURE,
    cli: INFRASTRUCTURE,
  },
  {
    operationId: "disconnectOAuthConsent",
    feature: "Disconnect a signed-in app",
    mcp: { none: "an MCP client is disconnected from Settings, not by itself" },
    sdk: ["disconnectConnectGrant"],
    cli: ["logout"],
  },
  {
    operationId: "getMe",
    feature: "Account, plan and usage",
    mcp: ["teak_v1_get_me"],
    sdk: ["me"],
    cli: ["whoami", "auth status"],
  },
  {
    operationId: "listCards",
    feature: "List and search cards",
    mcp: [
      "teak_v1_list_cards",
      "teak_v1_search_cards",
      "teak_v1_list_favorite_cards",
      "teak_v1_find_similar_cards",
      "search",
    ],
    sdk: ["cards.list", "cards.search", "cards.favorites", "cards.similar"],
    cli: [
      "cards list",
      "cards search",
      "cards favorites",
      "cards trash",
      "cards similar",
      "ls",
      "search",
      "similar",
      "trash",
    ],
  },
  {
    operationId: "createCard",
    feature: "Save a card",
    mcp: ["teak_v1_create_card"],
    sdk: ["cards.create"],
    cli: ["cards create", "add"],
  },
  {
    operationId: "createUpload",
    feature: "Upload a file",
    mcp: ["teak_v1_create_upload"],
    sdk: ["uploads.create"],
    cli: ["cards create", "add"],
  },
  {
    operationId: "bulkCards",
    feature: "Act on up to 100 cards",
    mcp: ["teak_v1_bulk_cards"],
    sdk: ["cards.bulk"],
    cli: ["cards bulk"],
  },
  {
    operationId: "listCardChanges",
    feature: "Cards changed since a time",
    mcp: ["teak_v1_get_card_changes"],
    sdk: ["cards.changes"],
    cli: ["cards changes"],
  },
  {
    operationId: "findDuplicateCard",
    feature: "Find the card that saves a URL",
    mcp: ["teak_v1_check_duplicate_url"],
    sdk: ["cards.duplicate"],
    cli: ["cards duplicate"],
  },
  {
    operationId: "getCard",
    feature: "Get a card",
    mcp: ["teak_v1_get_card", "teak_v1_get_card_links", "fetch"],
    sdk: ["cards.get", "cards.links"],
    cli: [
      "cards get",
      "cards links",
      "cards open",
      "cards download",
      "links",
      "open",
      "download",
    ],
  },
  {
    operationId: "updateCard",
    feature: "Edit, archive or retag a card",
    mcp: ["teak_v1_update_card", "teak_v1_set_card_archived"],
    sdk: ["cards.update", "cards.setArchived"],
    cli: [
      "cards update",
      "cards archive",
      "cards unarchive",
      "archive",
      "unarchive",
      "tags add",
      "tags rm",
    ],
  },
  {
    operationId: "deleteCard",
    feature: "Move to Trash or delete forever",
    mcp: ["teak_v1_delete_card"],
    sdk: ["cards.delete"],
    cli: ["cards delete", "rm"],
  },
  {
    operationId: "restoreCard",
    feature: "Restore from Trash",
    mcp: ["teak_v1_restore_card"],
    sdk: ["cards.restore"],
    cli: ["cards restore", "restore"],
  },
  {
    operationId: "getCardContent",
    feature: "A card's full text",
    mcp: ["teak_v1_get_card_content"],
    sdk: ["cards.content"],
    cli: ["cards content", "content"],
  },
  {
    operationId: "refreshCard",
    feature: "Refresh a card's details",
    mcp: ["teak_v1_refresh_card"],
    sdk: ["cards.refresh"],
    cli: ["cards refresh", "refresh"],
  },
  {
    operationId: "createThumbnailUpload",
    feature: "Upload a link's new image",
    mcp: ["teak_v1_create_thumbnail_upload"],
    sdk: ["cards.createThumbnailUpload"],
    cli: ["cards thumbnail"],
  },
  {
    operationId: "setCardThumbnail",
    feature: "Replace a link's image",
    mcp: ["teak_v1_set_card_thumbnail"],
    sdk: ["cards.setThumbnail"],
    cli: ["cards thumbnail"],
  },
  {
    operationId: "resetCardThumbnail",
    feature: "Reset a link's image",
    mcp: ["teak_v1_reset_card_thumbnail"],
    sdk: ["cards.resetThumbnail"],
    cli: ["cards thumbnail"],
  },
  {
    operationId: "markCardDone",
    feature: "Mark a link done",
    mcp: ["teak_v1_set_card_done"],
    sdk: ["cards.setDone"],
    cli: ["cards done", "done"],
  },
  {
    operationId: "unmarkCardDone",
    feature: "Unmark a link done",
    mcp: {
      none: "teak_v1_set_card_done with done: false calls it; one tool sets both states",
    },
    sdk: {
      none: "cards.setDone(id, false) calls it; one method sets both states",
    },
    cli: ["cards done", "done"],
  },
  {
    operationId: "saveCardPdf",
    feature: "Save a paper's PDF",
    mcp: ["teak_v1_save_card_pdf"],
    sdk: ["cards.savePdf"],
    cli: ["cards save-pdf"],
  },
  {
    operationId: "setCardFavorite",
    feature: "Favorite a card",
    mcp: ["teak_v1_set_card_favorite"],
    sdk: ["cards.setFavorite"],
    cli: ["cards favorite", "fav"],
  },
  {
    operationId: "listTags",
    feature: "List tags",
    mcp: ["teak_v1_list_tags"],
    sdk: ["tags.list"],
    cli: ["tags", "tags list"],
  },
  {
    operationId: "renameTag",
    feature: "Rename a tag everywhere",
    mcp: ["teak_v1_rename_tag"],
    sdk: ["tags.rename"],
    cli: ["tags rename"],
  },
  {
    operationId: "mergeTags",
    feature: "Merge tags",
    mcp: ["teak_v1_merge_tags"],
    sdk: ["tags.merge"],
    cli: ["tags merge"],
  },
  {
    operationId: "deleteTag",
    feature: "Delete a tag everywhere",
    mcp: ["teak_v1_delete_tag"],
    sdk: ["tags.delete"],
    cli: ["tags delete"],
  },
  {
    operationId: "getTagOperation",
    feature: "Progress of a tag change",
    mcp: ["teak_v1_get_tag_operation"],
    sdk: ["tags.operation"],
    cli: ["tags status"],
  },
  {
    operationId: "listFolders",
    feature: "List folders",
    mcp: ["teak_v1_list_folders"],
    sdk: ["folders.list"],
    cli: ["folders", "folders list"],
  },
  {
    operationId: "createFolder",
    feature: "Create a folder or smart folder",
    mcp: ["teak_v1_create_folder"],
    sdk: ["folders.create"],
    cli: ["folders create"],
  },
  {
    operationId: "getFolder",
    feature: "Get a folder",
    mcp: ["teak_v1_get_folder"],
    sdk: ["folders.get"],
    cli: ["folders get"],
  },
  {
    operationId: "updateFolder",
    feature: "Rename, recolor or change a smart search",
    mcp: ["teak_v1_update_folder"],
    sdk: ["folders.update"],
    cli: ["folders rename"],
  },
  {
    operationId: "deleteFolder",
    feature: "Delete a folder, keeping its cards",
    mcp: ["teak_v1_delete_folder"],
    sdk: ["folders.delete"],
    cli: ["folders rm"],
  },
  {
    operationId: "addCardsToFolder",
    feature: "Add cards to a folder",
    mcp: ["teak_v1_add_cards_to_folder"],
    sdk: ["folders.addCards"],
    cli: ["folders add"],
  },
  {
    operationId: "removeCardsFromFolder",
    feature: "Remove cards from a folder",
    mcp: ["teak_v1_remove_cards_from_folder"],
    sdk: ["folders.removeCards"],
    cli: ["folders remove"],
  },
  {
    operationId: "startExport",
    feature: "Export everything as a ZIP",
    mcp: NO_AGENT_EXPORTS,
    sdk: ["exports.start"],
    cli: ["export"],
  },
  {
    operationId: "getLatestExport",
    feature: "The latest export",
    mcp: NO_AGENT_EXPORTS,
    sdk: ["exports.latest"],
    cli: ["export status", "export download"],
  },
];

/**
 * Account changes the Teak apps make that no public surface does: no API
 * operation, MCP tool, SDK method or CLI command. `convex` names the session
 * function that makes the change, and `readBy` the operation that reports it.
 */
export interface AppOnlyChange {
  convex: string;
  feature: string;
  readBy?: string;
  reason: string;
}

export const APP_ONLY_CHANGES: readonly AppOnlyChange[] = [
  {
    feature: "Set the account language",
    convex: "settings/preferences:setLocale",
    readBy: "getMe",
    reason: "a display preference set in Settings",
  },
];

export const CLI_LOCAL_COMMANDS: Record<string, string> = {
  login: "signs in through the browser and stores the credential",
  auth: "groups `auth status`",
  cards: "groups the card commands",
};

export const SDK_LOCAL_MEMBERS: Record<string, string> = {
  "uploads.putFile": "uploads bytes straight to the signed storage URL",
};

const cell = (surface: Surface) =>
  Array.isArray(surface)
    ? surface.map((name) => `\`${name}\``).join(", ")
    : `none: ${(surface as IntentionalGap).none}`;

export const parityMarkdown = () =>
  [
    "| Feature | API operation | MCP | SDK | CLI |",
    "| --- | --- | --- | --- | --- |",
    ...PUBLIC_PARITY.map(
      (row) =>
        `| ${row.feature} | \`${row.operationId}\` | ${cell(row.mcp)} | ${cell(row.sdk)} | ${cell(row.cli)} |`
    ),
    "",
    "| App-only change | Read by | Why no API, MCP, SDK or CLI setter |",
    "| --- | --- | --- |",
    ...APP_ONLY_CHANGES.map(
      (row) =>
        `| ${row.feature} | ${row.readBy ? `\`${row.readBy}\`` : "none"} | ${row.reason} |`
    ),
  ].join("\n");

if (import.meta.main) {
  console.log(parityMarkdown());
}
