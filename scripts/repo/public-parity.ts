import {
  TEAK_TOOLS,
  type TeakTool,
  toolInputSchema,
} from "../../packages/convex/mcp/catalog";
import type { PublicApiOperationId } from "../../packages/convex/shared/publicApiContract";

export interface IntentionalGap {
  none: string;
}

export type Surface = readonly string[] | IntentionalGap;

export interface PublicParityRow {
  cli: Surface;
  feature: string;
  /**
   * Why no MCP tool calls the operation. The tools that do are read from
   * the MCP catalog, which names each tool's operation.
   */
  mcp?: IntentionalGap;
  operationId: PublicApiOperationId;
  /** The Raycast AI tools (`apps/raycast/src/tools`) that call it. */
  raycast?: readonly string[];
  sdk: Surface;
}

const INFRASTRUCTURE: IntentionalGap = {
  none: "infrastructure endpoint for monitors and API clients, not a feature",
};
const BROWSER_CAPTURE_ONLY: IntentionalGap = {
  none: "browser capture only",
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
    sdk: ["me"],
    cli: ["whoami", "auth status"],
  },
  {
    operationId: "listCards",
    feature: "List and search cards",
    sdk: [
      "cards.list",
      "cards.search",
      "cards.favorites",
      "cards.pinned",
      "cards.similar",
    ],
    cli: [
      "cards list",
      "cards search",
      "cards favorites",
      "cards pins",
      "cards trash",
      "cards similar",
      "ls",
      "search",
      "similar",
      "trash",
    ],
    raycast: ["search-cards", "get-recent"],
  },
  {
    operationId: "createCard",
    feature: "Save a card",
    sdk: ["cards.create"],
    cli: ["cards create", "add"],
    raycast: ["save-card"],
  },
  {
    operationId: "createUpload",
    feature: "Upload a file",
    sdk: ["uploads.create"],
    cli: ["cards create", "add"],
  },
  {
    operationId: "bulkCards",
    feature: "Act on up to 100 cards",
    sdk: ["cards.bulk"],
    cli: ["cards bulk"],
  },
  {
    operationId: "listCardChanges",
    feature: "Cards changed since a time",
    sdk: ["cards.changes"],
    cli: ["cards changes"],
  },
  {
    operationId: "findDuplicateCard",
    feature: "Find the card that saves a URL",
    sdk: ["cards.duplicate"],
    cli: ["cards duplicate"],
  },
  {
    operationId: "getCard",
    feature: "Get a card",
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
    raycast: ["get-card"],
  },
  {
    operationId: "updateCard",
    feature: "Edit, archive or retag a card",
    sdk: ["cards.update", "cards.setArchived"],
    cli: [
      "cards update",
      "cards archive",
      "cards unarchive",
      "archive",
      "unarchive",
      "tags add",
      "tags remove",
    ],
    raycast: ["update-card"],
  },
  {
    operationId: "deleteCard",
    feature: "Move to Trash or delete forever",
    sdk: ["cards.delete"],
    cli: ["cards delete", "rm"],
  },
  {
    operationId: "restoreCard",
    feature: "Restore from Trash",
    sdk: ["cards.restore"],
    cli: ["cards restore", "restore"],
  },
  {
    operationId: "getCardContent",
    feature: "A card's full text",
    sdk: ["cards.content"],
    cli: ["cards content", "content"],
  },
  {
    operationId: "refreshCard",
    feature: "Refresh a card's details",
    sdk: ["cards.refresh"],
    cli: ["cards refresh", "refresh"],
  },
  {
    operationId: "createThumbnailUpload",
    feature: "Upload a link's new image",
    sdk: ["cards.createThumbnailUpload"],
    cli: ["cards thumbnail"],
  },
  {
    operationId: "createPageSnapshotUpload",
    feature: "Upload the page a link was saved from",
    mcp: BROWSER_CAPTURE_ONLY,
    sdk: ["pageSnapshots.createUpload"],
    cli: BROWSER_CAPTURE_ONLY,
  },
  {
    operationId: "setCardThumbnail",
    feature: "Replace a link's image",
    sdk: ["cards.setThumbnail"],
    cli: ["cards thumbnail"],
  },
  {
    operationId: "resetCardThumbnail",
    feature: "Reset a link's image",
    sdk: ["cards.resetThumbnail"],
    cli: ["cards thumbnail"],
  },
  {
    operationId: "markCardDone",
    feature: "Mark a link done",
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
    cli: ["cards todo", "todo"],
  },
  {
    operationId: "saveCardPdf",
    feature: "Save a paper's PDF",
    sdk: ["cards.savePdf"],
    cli: ["cards save-pdf"],
  },
  {
    operationId: "setCardFavorite",
    feature: "Favorite a card",
    sdk: ["cards.setFavorite"],
    cli: ["cards favorite", "fav", "cards unfavorite", "unfav"],
    raycast: ["favorite-card"],
  },
  {
    operationId: "setCardPinned",
    feature: "Pin a card to the top",
    sdk: ["cards.setPinned"],
    cli: ["cards pin", "pin", "cards unpin", "unpin"],
  },
  {
    operationId: "reorderPinnedCards",
    feature: "Reorder pinned cards",
    sdk: ["cards.reorderPinned"],
    cli: ["cards pins order"],
  },
  {
    operationId: "listTags",
    feature: "List tags",
    sdk: ["tags.list"],
    cli: ["tags", "tags list"],
    raycast: ["list-tags"],
  },
  {
    operationId: "renameTag",
    feature: "Rename a tag everywhere",
    sdk: ["tags.rename"],
    cli: ["tags rename"],
  },
  {
    operationId: "mergeTags",
    feature: "Merge tags",
    sdk: ["tags.merge"],
    cli: ["tags merge"],
  },
  {
    operationId: "deleteTag",
    feature: "Delete a tag everywhere",
    sdk: ["tags.delete"],
    cli: ["tags delete"],
  },
  {
    operationId: "getTagOperation",
    feature: "Progress of a tag change",
    sdk: ["tags.operation"],
    cli: ["tags status"],
  },
  {
    operationId: "listFolders",
    feature: "List folders",
    sdk: ["folders.list"],
    cli: ["folders", "folders list"],
    raycast: ["list-folders"],
  },
  {
    operationId: "createFolder",
    feature: "Create a folder or smart folder",
    sdk: ["folders.create"],
    cli: ["folders create"],
  },
  {
    operationId: "getFolder",
    feature: "Get a folder",
    sdk: ["folders.get"],
    cli: ["folders get"],
  },
  {
    operationId: "updateFolder",
    feature: "Rename, recolor, change a smart search or a folder's rules",
    sdk: ["folders.update"],
    cli: ["folders rename", "folders rules"],
  },
  {
    operationId: "deleteFolder",
    feature: "Delete a folder, keeping its cards",
    sdk: ["folders.delete"],
    cli: ["folders delete"],
  },
  {
    operationId: "addCardsToFolder",
    feature: "Add cards to a folder",
    sdk: ["folders.addCards"],
    cli: ["folders add"],
  },
  {
    operationId: "removeCardsFromFolder",
    feature: "Remove cards from a folder",
    sdk: ["folders.removeCards"],
    cli: ["folders remove"],
  },
  {
    operationId: "getFolderRuleRun",
    feature: "Progress of a folder rule run",
    sdk: ["folders.getRuleRun"],
    cli: ["folders rule-run"],
  },
  {
    operationId: "undoFolderRuleRun",
    feature: "Undo a folder rule run",
    sdk: ["folders.undoRuleRun"],
    cli: ["folders undo-rule-run"],
  },
  {
    operationId: "listHighlights",
    feature: "List a link's highlights",
    sdk: ["highlights.list"],
    cli: ["highlights list"],
  },
  {
    operationId: "createHighlight",
    feature: "Highlight a passage of a link's article by its text",
    sdk: ["highlights.create"],
    cli: ["highlights add"],
  },
  {
    operationId: "updateHighlight",
    feature: "Change or clear a highlight's note",
    sdk: ["highlights.update"],
    cli: ["highlights note"],
  },
  {
    operationId: "deleteHighlight",
    feature: "Remove a highlight",
    sdk: ["highlights.delete"],
    cli: ["highlights delete"],
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
  completion: "prints a shell completion script; it makes no request",
  highlights: "groups the highlight commands",
};

export const SDK_LOCAL_MEMBERS: Record<string, string> = {
  "uploads.putFile": "uploads bytes straight to the signed storage URL",
};

type JsonSchema = Record<string, unknown>;

/**
 * The smallest arguments a JSON Schema describes: each required property
 * with its first allowed value. Enough to see which operation a tool calls.
 */
export const sampleFromSchema = (schema: JsonSchema): unknown => {
  if ("const" in schema) {
    return schema.const;
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum[0];
  }
  if (Array.isArray(schema.anyOf)) {
    return sampleFromSchema(schema.anyOf[0] as JsonSchema);
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<
        string,
        JsonSchema
      >;
      const required = (schema.required ?? []) as string[];
      return Object.fromEntries(
        required.map((name) => [name, sampleFromSchema(properties[name] ?? {})])
      );
    }
    case "array":
      return Array.from({ length: Number(schema.minItems ?? 0) }, () =>
        sampleFromSchema((schema.items ?? {}) as JsonSchema)
      );
    case "boolean":
      return true;
    case "integer":
    case "number":
      return Number(schema.minimum ?? 1);
    default:
      return "x1";
  }
};

const operationOf = (tool: TeakTool<unknown>): PublicApiOperationId =>
  tool.call(sampleFromSchema(toolInputSchema(tool.schema))).operationId;

/** The MCP tools that call each operation. */
export const mcpToolsByOperation = (): Map<PublicApiOperationId, string[]> => {
  const byOperation = new Map<PublicApiOperationId, string[]>();
  for (const tool of TEAK_TOOLS) {
    const operationId = operationOf(tool);
    byOperation.set(operationId, [
      ...(byOperation.get(operationId) ?? []),
      tool.name,
    ]);
  }
  return byOperation;
};

export const mcpSurface = (row: PublicParityRow): Surface =>
  row.mcp ?? mcpToolsByOperation().get(row.operationId) ?? [];

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
        `| ${row.feature} | \`${row.operationId}\` | ${cell(mcpSurface(row))} | ${cell(row.sdk)} | ${cell(row.cli)} |`
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
