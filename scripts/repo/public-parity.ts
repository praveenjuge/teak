import { SHORTCUTS } from "../../apps/cli/src/index";
import { CLI_OPERATIONS } from "../../apps/cli/src/operations";
import {
  TEAK_TOOLS,
  type TeakTool,
  toolInputSchema,
} from "../../packages/convex/mcp/catalog";
import {
  PUBLIC_API_OPERATION_IDS,
  type PublicApiOperationId,
} from "../../packages/convex/shared/publicApiContract";
import { SDK_OPERATIONS } from "../../packages/sdk/src/operations";

export interface IntentionalGap {
  none: string;
}

export type Surface = readonly string[] | IntentionalGap;

export interface PublicParityGaps {
  /** Why no CLI command calls the operation; the commands that do declare it. */
  cliGap?: IntentionalGap;
  /**
   * Why no MCP tool calls the operation. The tools that do are read from
   * the MCP catalog, which names each tool's operation.
   */
  mcp?: IntentionalGap;
  /** The Raycast AI tools (`apps/raycast/src/tools`) that call it. */
  raycast?: readonly string[];
  /** Why no SDK member calls the operation; the members that do declare it. */
  sdkGap?: IntentionalGap;
}

export interface PublicParityRow extends PublicParityGaps {
  operationId: PublicApiOperationId;
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

/**
 * What the surfaces leave out, by operation; an operation every surface
 * reaches has no entry. The MCP tools that call an operation are read from
 * the catalog, the SDK members and CLI commands from what each declares.
 */
export const PUBLIC_PARITY: Partial<
  Record<PublicApiOperationId, PublicParityGaps>
> = {
  getHealth: {
    mcp: INFRASTRUCTURE,
    sdkGap: INFRASTRUCTURE,
    cliGap: INFRASTRUCTURE,
  },
  getApiDiscovery: {
    mcp: INFRASTRUCTURE,
    sdkGap: INFRASTRUCTURE,
    cliGap: INFRASTRUCTURE,
  },
  disconnectOAuthConsent: {
    mcp: { none: "an MCP client is disconnected from Settings, not by itself" },
  },
  listCards: {
    raycast: ["search-cards", "get-recent"],
  },
  createCard: {
    raycast: ["save-card"],
  },
  getCard: {
    raycast: ["get-card"],
  },
  updateCard: {
    raycast: ["update-card"],
  },
  restoreCard: {
    cliGap: {
      none: "teak restore restores through bulkCards, up to 100 cards a request",
    },
  },
  createPageSnapshotUpload: {
    mcp: BROWSER_CAPTURE_ONLY,
    cliGap: BROWSER_CAPTURE_ONLY,
  },
  unmarkCardDone: {
    mcp: {
      none: "teak_v1_set_card_done with done: false calls it; one tool sets both states",
    },
  },
  setCardFavorite: {
    raycast: ["favorite-card"],
  },
  listTags: {
    raycast: ["list-tags"],
  },
  listFolders: {
    raycast: ["list-folders"],
  },
  startExport: {
    mcp: NO_AGENT_EXPORTS,
  },
  getLatestExport: {
    mcp: NO_AGENT_EXPORTS,
  },
};

/** Every public operation with its gaps, in contract order. */
export const PUBLIC_PARITY_ROWS: readonly PublicParityRow[] =
  PUBLIC_API_OPERATION_IDS.map((operationId) => ({
    operationId,
    ...PUBLIC_PARITY[operationId],
  }));

export interface AppOnlyChange {
  convex: string;
  feature: string;
  readBy?: PublicApiOperationId;
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
