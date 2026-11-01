import {
  type AnalyticsEventItem,
  buildWorkflowDispatchSigningPayload,
  type DispatchItem,
  type DispatchItemResult,
  type DispatchResult,
  isWorkflowInstanceId,
  isWorkflowName,
  MAX_DISPATCH_DELETE_KEYS,
  MAX_DISPATCH_ITEMS,
  WORKFLOW_RPC_MAX_TTL_SECONDS,
  type WorkflowName,
} from "@teak/files-protocol";
import {
  allowedConvexSiteUrl,
  type ConvexRpcEnv,
  workflowRpcSecret,
} from "../convexRpc";
import { sha256Hex, verifyHmacPayload } from "../lib";
import { sendInBatches } from "../queues/sendBatch";
import { isValidUploadKey } from "../storage/upload";
import { sendBackendEvents, type TelemetryEnvVars } from "../telemetry";

export interface ObjectDeletionMessage {
  keys: string[];
}

export interface WorkflowBindingsEnv extends ConvexRpcEnv, TelemetryEnvVars {
  ACCOUNT_DELETION?: Workflow;
  CARD_PROCESSING?: Workflow;
  EXPORTS?: Workflow;
  IMPORTS?: Workflow;
  MAINTENANCE?: Workflow;
  OBJECT_DELETIONS?: Queue<ObjectDeletionMessage>;
}

export const workflowBinding = (
  env: WorkflowBindingsEnv,
  name: WorkflowName
): Workflow | undefined => {
  switch (name) {
    case "account-deletion":
      return env.ACCOUNT_DELETION;
    case "card-processing":
      return env.CARD_PROCESSING;
    case "export":
      return env.EXPORTS;
    case "import":
      return env.IMPORTS;
    case "maintenance":
      return env.MAINTENANCE;
    default:
      return;
  }
};

/** Workflows' `get` throws for an ID it has no instance for. */
export const isMissingInstance = (error: unknown): boolean =>
  /not[\s._-]?found|does not exist/iu.test(
    error instanceof Error ? error.message : String(error)
  );

/** createBatch reports an ID that already exists, or repeats, with these. */
export const DUPLICATE_INSTANCE_CODES = new Set([10_405, 10_415]);

const EVENT_NAME = /^[a-z][a-z0-9_]{0,99}$/u;
const EVENT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const optionalString = (
  value: unknown,
  max: number
): string | null | undefined => {
  if (value === undefined) {
    return;
  }
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
};

const parseAnalyticsEvent = (
  record: Record<string, unknown>
): AnalyticsEventItem | null => {
  const { event, properties, set, timestamp, uuid } = record;
  const appVersion = optionalString(record.appVersion, 64);
  const distinctId = optionalString(record.distinctId, 200);
  if (
    appVersion === null ||
    distinctId === null ||
    typeof event !== "string" ||
    !EVENT_NAME.test(event) ||
    !isPlainObject(properties) ||
    (set !== undefined && !isPlainObject(set)) ||
    typeof timestamp !== "string" ||
    timestamp.length > 40 ||
    !Number.isFinite(Date.parse(timestamp)) ||
    typeof uuid !== "string" ||
    !EVENT_UUID.test(uuid)
  ) {
    return null;
  }
  return {
    ...(appVersion ? { appVersion } : {}),
    ...(distinctId ? { distinctId } : {}),
    event,
    properties,
    ...(set ? { set } : {}),
    timestamp,
    type: "analytics-event",
    uuid,
  };
};

const parseItem = (record: unknown): DispatchItem | null => {
  if (!isPlainObject(record)) {
    return null;
  }
  if (record.type === "analytics-event") {
    return parseAnalyticsEvent(record);
  }
  if (record.type === "delete-objects") {
    const { keys } = record;
    if (
      !Array.isArray(keys) ||
      keys.length === 0 ||
      keys.length > MAX_DISPATCH_DELETE_KEYS ||
      keys.some((key) => typeof key !== "string" || !isValidUploadKey(key))
    ) {
      return null;
    }
    return { keys: keys as string[], type: "delete-objects" };
  }
  if (record.type === "workflow") {
    const { id, params, terminate, workflow } = record;
    if (
      !(isWorkflowName(workflow) && isWorkflowInstanceId(id) && params) ||
      typeof params !== "object" ||
      Array.isArray(params) ||
      (terminate !== undefined &&
        !(
          Array.isArray(terminate) &&
          terminate.length <= 20 &&
          terminate.every(isWorkflowInstanceId)
        ))
    ) {
      return null;
    }
    return {
      id,
      params: params as Record<string, unknown>,
      ...(terminate ? { terminate: terminate as string[] } : {}),
      type: "workflow",
      workflow,
    };
  }
  return null;
};

export const parseDispatchItems = (params: Record<string, unknown>) => {
  const { items } = params;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > MAX_DISPATCH_ITEMS
  ) {
    throw new Error("invalid_dispatch_items");
  }
  return items.map(parseItem);
};

/**
 * Whether the dispatching deployment signed these items with its own
 * workflow RPC secret. The files signing secret that authenticated the op is
 * shared with development, so it alone can't say which deployment sent it.
 */
const hasValidDispatchProof = async (
  env: WorkflowBindingsEnv,
  convexSiteUrl: string,
  params: Record<string, unknown>,
  now: number
): Promise<boolean> => {
  const { expiresAt, items, signature } = params;
  if (typeof expiresAt !== "string" || typeof signature !== "string") {
    return false;
  }
  const expiry = Number(expiresAt);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expiry) ||
    String(expiry) !== expiresAt ||
    expiry < nowSeconds ||
    expiry > nowSeconds + WORKFLOW_RPC_MAX_TTL_SECONDS
  ) {
    return false;
  }
  const secret = await workflowRpcSecret(env, convexSiteUrl);
  if (!secret) {
    return false;
  }
  return await verifyHmacPayload(
    secret,
    buildWorkflowDispatchSigningPayload({
      convexSiteUrl,
      expiresAt,
      itemsSha256: await sha256Hex(JSON.stringify(items)),
    }),
    signature
  );
};

const terminateInstances = async (binding: Workflow, ids: string[]) => {
  await Promise.allSettled(
    ids.map(async (id) => {
      const instance = await binding.get(id);
      const { status } = await instance.status();
      if (
        status !== "complete" &&
        status !== "errored" &&
        status !== "terminated"
      ) {
        await instance.terminate();
      }
    })
  );
};

export const runDispatch = async (
  env: WorkflowBindingsEnv,
  params: Record<string, unknown>,
  now = Date.now(),
  ctx?: Pick<ExecutionContext, "waitUntil">
): Promise<DispatchResult> => {
  const convexSiteUrl = allowedConvexSiteUrl(env, params.convexSiteUrl);
  if (!convexSiteUrl) {
    throw new Error("invalid_convex_site_url");
  }
  if (!(await hasValidDispatchProof(env, convexSiteUrl, params, now))) {
    throw new Error("invalid_dispatch_proof");
  }
  const items = parseDispatchItems(params);
  const results: DispatchItemResult[] = items.map((item, index) => ({
    index,
    ok: false,
    ...(item ? {} : { error: "invalid_item" }),
  }));

  // Convex keeps no row for an event it hands over, so each one counts as
  // delivered; the send is best effort and runs after the response.
  const events = items.flatMap((item, index) => {
    if (item?.type !== "analytics-event") {
      return [];
    }
    results[index] = { index, ok: true };
    return [item];
  });
  if (events.length > 0) {
    const sent = sendBackendEvents(env, events);
    if (ctx) {
      ctx.waitUntil(sent);
    } else {
      await sent;
    }
  }

  const deletions = items.flatMap((item, index) =>
    item?.type === "delete-objects" ? [{ index, keys: item.keys }] : []
  );
  if (deletions.length > 0) {
    if (env.OBJECT_DELETIONS) {
      const failed = await sendInBatches(
        env.OBJECT_DELETIONS,
        deletions.map(({ keys }) => ({ keys }))
      );
      deletions.forEach(({ index }, position) => {
        const error = failed.get(position);
        results[index] =
          error === undefined
            ? { index, ok: true }
            : { error, index, ok: false };
      });
    } else {
      for (const { index } of deletions) {
        results[index] = { error: "queue_missing", index, ok: false };
      }
    }
  }

  const byWorkflow = new Map<
    WorkflowName,
    Array<{ index: number; item: Extract<DispatchItem, { type: "workflow" }> }>
  >();
  items.forEach((item, index) => {
    if (item?.type === "workflow") {
      const group = byWorkflow.get(item.workflow) ?? [];
      group.push({ index, item });
      byWorkflow.set(item.workflow, group);
    }
  });
  for (const [name, group] of byWorkflow) {
    const binding = workflowBinding(env, name);
    if (!binding) {
      for (const { index } of group) {
        results[index] = { error: "workflow_missing", index, ok: false };
      }
      continue;
    }
    const replaced = group.flatMap(({ item }) => item.terminate ?? []);
    if (replaced.length > 0) {
      await terminateInstances(binding, replaced);
    }
    try {
      const { errors } = await binding.createBatch({
        instances: group.map(({ item }) => ({
          id: item.id,
          params: { ...item.params, convexSiteUrl },
        })),
      });
      const failed = new Map<number, string>();
      for (const error of errors) {
        if (!DUPLICATE_INSTANCE_CODES.has(error.code)) {
          failed.set(error.index, error.message);
        }
      }
      group.forEach(({ index }, position) => {
        const error = failed.get(position);
        results[index] =
          error === undefined
            ? { index, ok: true }
            : { error, index, ok: false };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "create_failed";
      for (const { index } of group) {
        results[index] = { error: message, index, ok: false };
      }
    }
  }
  return { results };
};
