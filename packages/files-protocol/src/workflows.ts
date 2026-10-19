export const WORKFLOW_RPC_PATH = "/__workflow/v1" as const;

export const WORKFLOW_RPC_MAX_TTL_SECONDS = 5 * 60;

export const WORKFLOW_RPC_MAX_BODY_BYTES = 4 * 1024 * 1024;

export const MAX_DAILY_USAGE_ROWS = 200;

export const WORKFLOW_RPC_HEADERS = {
  expiresAt: "x-teak-expires-at",
  requestId: "x-teak-request-id",
  signature: "x-teak-signature",
} as const;

export const buildWorkflowRpcSecretPayload = (convexSiteUrl: string): string =>
  ["workflow-rpc-secret", "1", convexSiteUrl].join("\n");

export const buildWorkflowRpcSigningPayload = ({
  bodySha256,
  convexSiteUrl,
  expiresAt,
  requestId,
}: {
  bodySha256: string;
  convexSiteUrl: string;
  expiresAt: string;
  requestId: string;
}): string =>
  ["workflow-rpc", "2", convexSiteUrl, requestId, expiresAt, bodySha256].join(
    "\n"
  );

/** Signed with the deployment's workflow RPC secret over `JSON.stringify(items)`. */
export const buildWorkflowDispatchSigningPayload = ({
  convexSiteUrl,
  expiresAt,
  itemsSha256,
}: {
  convexSiteUrl: string;
  expiresAt: string;
  itemsSha256: string;
}): string =>
  ["workflow-dispatch", "1", convexSiteUrl, expiresAt, itemsSha256].join("\n");

export type WorkflowRpcKind = "action" | "mutation" | "query";

/**
 * A card-processing write only lands while the card is still on the
 * processing revision the workflow started for. Editing a card bumps the
 * revision, so a run it replaced can never overwrite newer output.
 */
export interface WorkflowRpcGuard {
  cardId: string;
  rev: number;
}

export interface WorkflowRpcRequest {
  /** Convex JSON (`convexToJson`) of the function's arguments. */
  args: unknown;
  guard?: WorkflowRpcGuard;
  kind: WorkflowRpcKind;
  /** `path/to/module:export`, as `getFunctionName` gives it. */
  name: string;
}

export const WORKFLOW_RPC_ERROR_CODES = [
  "card_missing",
  "stale_processing_revision",
] as const;
export type WorkflowRpcErrorCode = (typeof WORKFLOW_RPC_ERROR_CODES)[number];

export type WorkflowRpcResponse =
  | { ok: true; value: unknown }
  | {
      error: { code?: string; data?: unknown; message: string };
      ok: false;
    };

const RPC_KINDS = new Set<string>(["action", "mutation", "query"]);
const FUNCTION_NAME = /^[A-Za-z0-9_/.-]{1,200}:[A-Za-z0-9_]{1,100}$/u;

export const parseWorkflowRpcRequest = (
  value: unknown
): WorkflowRpcRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const { args, guard, kind, name } = value as Record<string, unknown>;
  if (
    typeof kind !== "string" ||
    !RPC_KINDS.has(kind) ||
    typeof name !== "string" ||
    !FUNCTION_NAME.test(name) ||
    args === undefined
  ) {
    return null;
  }
  if (guard !== undefined) {
    if (!guard || typeof guard !== "object" || Array.isArray(guard)) {
      return null;
    }
    const { cardId, rev } = guard as Record<string, unknown>;
    if (
      kind !== "mutation" ||
      typeof cardId !== "string" ||
      !cardId ||
      typeof rev !== "number" ||
      !Number.isSafeInteger(rev) ||
      rev < 0
    ) {
      return null;
    }
    return {
      args,
      guard: { cardId, rev },
      kind: kind as WorkflowRpcKind,
      name,
    };
  }
  return { args, kind: kind as WorkflowRpcKind, name };
};

export const WORKFLOW_NAMES = [
  "card-processing",
  "export",
  "import",
  "account-deletion",
  "maintenance",
] as const;
export type WorkflowName = (typeof WORKFLOW_NAMES)[number];

export const isWorkflowName = (value: unknown): value is WorkflowName =>
  typeof value === "string" &&
  (WORKFLOW_NAMES as readonly string[]).includes(value);

const INSTANCE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/u;

export const isWorkflowInstanceId = (value: unknown): value is string =>
  typeof value === "string" && INSTANCE_ID.test(value);

export const cardProcessingInstanceId = (cardId: string, rev: number) =>
  `card-${cardId}-${rev}`;
export const exportInstanceId = (jobId: string) => `export-${jobId}`;
export const importInstanceId = (jobId: string) => `import-${jobId}`;
export const accountDeletionInstanceId = (
  stateId: string,
  generation: number,
  attempt: number
) => `account-deletion-${stateId}-${generation}-${attempt}`;

/** Tasks the maintenance workflow runs; `capabilities` lists them. */
export const MAINTENANCE_TASKS = [
  "card-cleanup",
  "export-cleanup",
  "orphan-sweep",
  "receipt-cleanup",
  "admin-snapshot",
] as const;
export type MaintenanceTask = (typeof MAINTENANCE_TASKS)[number];

export interface MaintenanceParams {
  /** The admin snapshot's UTC day (YYYY-MM-DD); yesterday when omitted. */
  date?: string;
  /** Started through Convex's outbox, so the run reports back to it. */
  dispatched?: true;
  task: MaintenanceTask;
}

/** An admin's snapshot request; every request is its own run. */
export const adminSnapshotInstanceId = (date: string, requestedAt: number) =>
  `admin-snapshot-${date}-manual-${requestedAt}`;

export const MAX_DISPATCH_ITEMS = 100;
export const MAX_DISPATCH_DELETE_KEYS = 100;

/**
 * A backend product event the Worker sends to PostHog as Convex would have
 * (`$lib: teak-backend`). Convex field names can't start with `$`, so the
 * Worker adds `$app_version` and `$set` itself.
 */
export interface AnalyticsEventItem {
  appVersion?: string;
  distinctId?: string;
  event: string;
  properties: Record<string, unknown>;
  set?: Record<string, unknown>;
  /** ISO time of the change that recorded the event. */
  timestamp: string;
  type: "analytics-event";
  /** PostHog drops a repeat of an event with the same UUID. */
  uuid: string;
}

export type DispatchItem =
  | {
      id: string;
      params: Record<string, unknown>;
      terminate?: string[];
      type: "workflow";
      workflow: WorkflowName;
    }
  | { keys: string[]; type: "delete-objects" }
  | AnalyticsEventItem;

/** Item types the `dispatch` op accepts, listed by the `capabilities` op. */
export const DISPATCH_ITEM_TYPES = [
  "workflow",
  "delete-objects",
  "analytics-event",
] as const satisfies readonly DispatchItem["type"][];

export interface DispatchParams {
  convexSiteUrl: string;
  /** Unix seconds; the proof is refused after this. */
  expiresAt: string;
  items: DispatchItem[];
  signature: string;
}

export interface WorkflowOriginParams {
  convexSiteUrl: string;
}

export const normalizeConvexSiteUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 300) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      !(url.protocol === "https:" || url.protocol === "http:") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const parseConvexSiteUrls = (value: string | undefined): string[] => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((entry) => normalizeConvexSiteUrl(entry.trim()))
      .filter((entry): entry is string => entry !== null)
  ),
];

export interface DispatchItemResult {
  error?: string;
  index: number;
  ok: boolean;
}

export interface DispatchResult {
  results: DispatchItemResult[];
}

export type WorkflowInstanceState =
  | "complete"
  | "errored"
  | "paused"
  | "queued"
  | "running"
  | "terminated"
  | "unknown"
  | "waiting"
  | "waitingForPause";

export type WorkflowCompletionStatus = "complete" | "errored";
