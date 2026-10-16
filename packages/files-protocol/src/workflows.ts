/**
 * Background work runs on Cloudflare Workflows and Queues inside the Files
 * Worker; Convex stays the database. The two talk in both directions:
 *
 * - Convex → Worker: the `dispatch` Files op starts workflow instances and
 *   queues object deletions. Like every Files op it is signed with the files
 *   signing secret, and its params also carry a proof signed with the
 *   deployment's workflow RPC secret, so it can only start work that reports
 *   to the deployment that sent it.
 * - Worker → Convex: `POST /__workflow/v1` runs one allowlisted internal
 *   query, mutation or action, signed with that deployment's workflow RPC
 *   secret.
 *
 * Each deployment's workflow RPC secret is derived from a root secret that
 * only the Worker holds, so the development deployment (which shares the
 * files signing secret with production) can never sign for production. Every
 * payload starts with its own label and names the deployment, so a signature
 * is never valid for another purpose or another deployment.
 */

export const WORKFLOW_RPC_PATH = "/__workflow/v1" as const;

/** Longest a signed RPC stays valid, in seconds. */
export const WORKFLOW_RPC_MAX_TTL_SECONDS = 5 * 60;

/** Largest RPC request body Convex accepts, in bytes. */
export const WORKFLOW_RPC_MAX_BODY_BYTES = 4 * 1024 * 1024;

export const WORKFLOW_RPC_HEADERS = {
  expiresAt: "x-teak-expires-at",
  requestId: "x-teak-request-id",
  signature: "x-teak-signature",
} as const;

/**
 * What the Worker signs with its root secret to get a deployment's workflow
 * RPC secret (hex HMAC-SHA256). `bun scripts/workflow-rpc-secret.ts` prints
 * it for a deployment's Convex environment.
 */
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

/** Error codes the gateway returns for a request it refused to run. */
export const WORKFLOW_RPC_ERROR_CODES = [
  /** The guard's card no longer exists. */
  "card_missing",
  /** The guard's revision is not the card's current processing revision. */
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

/** The request in a body, or null when the body is not one valid request. */
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

/** The Cloudflare Workflows Convex can start through `dispatch`. */
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

/** Instance IDs: letters, digits, `-` and `_`, at most 100 characters. */
const INSTANCE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/u;

export const isWorkflowInstanceId = (value: unknown): value is string =>
  typeof value === "string" && INSTANCE_ID.test(value);

/** One card-processing run per card and processing revision. */
export const cardProcessingInstanceId = (cardId: string, rev: number) =>
  `card-${cardId}-${rev}`;
export const exportInstanceId = (jobId: string) => `export-${jobId}`;
export const importInstanceId = (jobId: string) => `import-${jobId}`;
/** A failed account deletion run is started again under the next attempt. */
export const accountDeletionInstanceId = (
  stateId: string,
  generation: number,
  attempt: number
) => `account-deletion-${stateId}-${generation}-${attempt}`;

export const MAX_DISPATCH_ITEMS = 100;
export const MAX_DISPATCH_DELETE_KEYS = 100;

export type DispatchItem =
  | {
      id: string;
      params: Record<string, unknown>;
      /** Instances this one replaces; stopped first, best effort. */
      terminate?: string[];
      type: "workflow";
      workflow: WorkflowName;
    }
  | { keys: string[]; type: "delete-objects" };

export interface DispatchParams {
  /**
   * The dispatching deployment's HTTP actions origin. Workflows call back the
   * deployment that started them; the Worker only accepts origins it lists
   * in `CONVEX_SITE_URLS`.
   */
  convexSiteUrl: string;
  /** Unix seconds; the proof is refused after this. */
  expiresAt: string;
  items: DispatchItem[];
  /** Hex HMAC of `buildWorkflowDispatchSigningPayload`. */
  signature: string;
}

/** Every workflow's params carry the deployment it reports to. */
export interface WorkflowOriginParams {
  convexSiteUrl: string;
}

/** Normalizes an origin for comparison; null when it isn't an http(s) origin. */
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

/** The origins listed in a comma-separated `CONVEX_SITE_URLS` value. */
export const parseConvexSiteUrls = (value: string | undefined): string[] => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((entry) => normalizeConvexSiteUrl(entry.trim()))
      .filter((entry): entry is string => entry !== null)
  ),
];

export interface DispatchItemResult {
  /** Why the item was not accepted; retry it later. */
  error?: string;
  index: number;
  ok: boolean;
}

export interface DispatchResult {
  results: DispatchItemResult[];
}

/** Statuses Cloudflare reports for an instance. */
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

/** What a workflow reports to Convex when it ends. */
export type WorkflowCompletionStatus = "complete" | "errored";
