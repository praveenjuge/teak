import { SHORTCUTS } from "../../apps/cli/src/index";
import { CLI_OPERATIONS } from "../../apps/cli/src/operations";
import {
  TEAK_TOOLS,
  type TeakTool,
  toolInputSchema,
} from "../../packages/convex/mcp/catalog";
import type { PublicApiOperationId } from "../../packages/convex/shared/publicApiContract";
import { SDK_OPERATIONS } from "../../packages/sdk/src/operations";

export interface IntentionalGap {
  none: string;
}

export type Surface = readonly string[] | IntentionalGap;

export interface PublicParityRow {
  /** Why no CLI command calls the operation; the commands that do declare it. */
  cliGap?: IntentionalGap;
  feature: string;
  /**
   * Why no MCP tool calls the operation. The tools that do are read from
   * the MCP catalog, which names each tool's operation.
   */
  mcp?: IntentionalGap;
  operationId: PublicApiOperationId;
  /** The Raycast AI tools (`apps/raycast/src/tools`) that call it. */
  raycast?: readonly string[];
  /** Why no SDK member calls the operation; the members that do declare it. */
  sdkGap?: IntentionalGap;
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
    sdkGap: INFRASTRUCTURE,
    cliGap: INFRASTRUCTURE,
  },
  {
    operationId: "getApiDiscovery",
    feature: "API discovery",
    mcp: INFRASTRUCTURE,
    sdkGap: INFRASTRUCTURE,
    cliGap: INFRASTRUCTURE,
  },
  {
    operationId: "disconnectOAuthConsent",
    feature: "Disconnect a signed-in app",
    mcp: { none: "an MCP client is disconnected from Settings, not by itself" },
  },
  {
    operationId: "getMe",
    feature: "Account, plan and usage",
  },
  {
    operationId: "listCards",
    feature: "List and search cards",
    raycast: ["search-cards", "get-recent"],
  },
  {
    operationId: "createCard",
    feature: "Save a card",
    raycast: ["save-card"],
  },
  {
    operationId: "createUpload",
    feature: "Upload a file",
  },
  {
    operationId: "bulkCards",
    feature: "Act on up to 100 cards",
  },
  {
    operationId: "listCardChanges",
    feature: "Cards changed since a time",
  },
  {
    operationId: "findDuplicateCard",
    feature: "Find the card that saves a URL",
  },
  {
    operationId: "getCard",
    feature: "Get a card",
    raycast: ["get-card"],
  },
  {
    operationId: "updateCard",
    feature: "Edit, archive or retag a card",
    raycast: ["update-card"],
  },
  {
    operationId: "deleteCard",
    feature: "Move to Trash or delete forever",
  },
  {
    operationId: "restoreCard",
    feature: "Restore from Trash",
    cliGap: {
      none: "teak restore restores through bulkCards, up to 100 cards a request",
    },
  },
  {
    operationId: "getCardContent",
    feature: "A card's full text",
  },
  {
    operationId: "refreshCard",
    feature: "Refresh a card's details",
  },
  {
    operationId: "createThumbnailUpload",
    feature: "Upload a link's new image",
  },
  {
    operationId: "createPageSnapshotUpload",
    feature: "Upload the page a link was saved from",
    mcp: BROWSER_CAPTURE_ONLY,
    cliGap: BROWSER_CAPTURE_ONLY,
  },
  {
    operationId: "setCardThumbnail",
    feature: "Replace a link's image",
  },
  {
    operationId: "resetCardThumbnail",
    feature: "Reset a link's image",
  },
  {
    operationId: "markCardDone",
    feature: "Mark a link done",
  },
  {
    operationId: "unmarkCardDone",
    feature: "Unmark a link done",
    mcp: {
      none: "teak_v1_set_card_done with done: false calls it; one tool sets both states",
    },
  },
  {
    operationId: "saveCardPdf",
    feature: "Save a paper's PDF",
  },
  {
    operationId: "setCardFavorite",
    feature: "Favorite a card",
    raycast: ["favorite-card"],
  },
  {
    operationId: "setCardPinned",
    feature: "Pin a card to the top",
  },
  {
    operationId: "reorderPinnedCards",
    feature: "Reorder pinned cards",
  },
  {
    operationId: "listTags",
    feature: "List tags",
    raycast: ["list-tags"],
  },
  {
    operationId: "renameTag",
    feature: "Rename a tag everywhere",
  },
  {
    operationId: "mergeTags",
    feature: "Merge tags",
  },
  {
    operationId: "deleteTag",
    feature: "Delete a tag everywhere",
  },
  {
    operationId: "getTagOperation",
    feature: "Progress of a tag change",
  },
  {
    operationId: "listFolders",
    feature: "List folders",
    raycast: ["list-folders"],
  },
  {
    operationId: "createFolder",
    feature: "Create a folder or smart folder",
  },
  {
    operationId: "getFolder",
    feature: "Get a folder",
  },
  {
    operationId: "updateFolder",
    feature: "Rename, recolor, change a smart search or a folder's rules",
  },
  {
    operationId: "deleteFolder",
    feature: "Delete a folder, keeping its cards",
  },
  {
    operationId: "addCardsToFolder",
    feature: "Add cards to a folder",
  },
  {
    operationId: "removeCardsFromFolder",
    feature: "Remove cards from a folder",
  },
  {
    operationId: "getFolderRuleRun",
    feature: "Progress of a folder rule run",
  },
  {
    operationId: "undoFolderRuleRun",
    feature: "Undo a folder rule run",
  },
  {
    operationId: "listHighlights",
    feature: "List a link's highlights",
  },
  {
    operationId: "createHighlight",
    feature: "Highlight a passage of a link's article by its text",
  },
  {
    operationId: "updateHighlight",
    feature: "Change or clear a highlight's note",
  },
  {
    operationId: "deleteHighlight",
    feature: "Remove a highlight",
  },
  {
    operationId: "startExport",
    feature: "Export everything as a ZIP",
    mcp: NO_AGENT_EXPORTS,
  },
  {
    operationId: "getLatestExport",
    feature: "The latest export",
    mcp: NO_AGENT_EXPORTS,
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

/** The names in `declared` whose operations include `operationId`. */
const calling = (
  declared: Readonly<Record<string, readonly PublicApiOperationId[]>>,
  operationId: PublicApiOperationId
) =>
  Object.entries(declared)
    .filter(([, operations]) => operations.includes(operationId))
    .map(([name]) => name);

/** Each CLI command's operations, its top-level shortcuts included. */
export const cliOperations = (): Record<
  string,
  readonly PublicApiOperationId[]
> => ({
  ...CLI_OPERATIONS,
  ...Object.fromEntries(
    Object.entries(SHORTCUTS).map(([shortcut, command]) => [
      shortcut,
      CLI_OPERATIONS[`cards ${command}`] ?? [],
    ])
  ),
});

export const sdkSurface = (row: PublicParityRow): Surface =>
  row.sdkGap ?? calling(SDK_OPERATIONS, row.operationId);

export const cliSurface = (row: PublicParityRow): Surface =>
  row.cliGap ?? calling(cliOperations(), row.operationId);
