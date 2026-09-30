import { convexToJson, jsonToConvex, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  env,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import { readBodyWithLimit } from "../linkMetadata/ssrf";
import { putObjectViaFilesWorker } from "./filesWorkerClient";
import { getR2Url } from "./fileUrls";
import { buildR2UserPrefix, deleteObject } from "./r2";
import { hashRawMetadata } from "./rawMetadata";

export const WORKFLOW_ARTIFACT_THRESHOLD = 16 * 1024;
export const WORKFLOW_ARTIFACT_MAX_BYTES = 1024 * 1024;
export interface WorkflowArtifactRef {
  artifactVersion: 1;
  byteLength: number;
  cardId: Id<"cards">;
  digest: string;
  generationNumber: number;
  key: string;
  userId: string;
  workflowId: string;
}

export const workflowArtifactKey = (
  ref: Omit<WorkflowArtifactRef, "key" | "byteLength" | "artifactVersion">
) => {
  if (
    !(
      /^[a-z0-9]+$/i.test(ref.cardId) &&
      /^[a-z0-9]+$/i.test(ref.workflowId) &&
      /^[a-f0-9]{64}$/.test(ref.digest) &&
      Number.isSafeInteger(ref.generationNumber) &&
      ref.generationNumber >= 0
    )
  ) {
    throw new Error("invalid_workflow_artifact_namespace");
  }
  return `${buildR2UserPrefix(ref.userId)}/${ref.cardId}/workflow-artifacts/${ref.workflowId}/${ref.generationNumber}/${ref.digest}.json`;
};

export const isWorkflowArtifactRef = (
  value: unknown
): value is WorkflowArtifactRef => {
  if (
    !(
      value &&
      typeof value === "object" &&
      "artifactVersion" in value &&
      value.artifactVersion === 1
    )
  ) {
    return false;
  }
  const ref = value as WorkflowArtifactRef;
  try {
    return (
      typeof ref.userId === "string" &&
      ref.userId.length > 0 &&
      ref.key === workflowArtifactKey(ref) &&
      Number.isSafeInteger(ref.byteLength) &&
      ref.byteLength > 0 &&
      ref.byteLength <= WORKFLOW_ARTIFACT_MAX_BYTES
    );
  } catch {
    return false;
  }
};

// Convex omits undefined object properties on the wire; preserve every supported
// Convex value, including bytes, bigint and non-finite numbers, in artifacts.
const withoutUndefined = (value: unknown): any => {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined);
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)])
    );
  }
  return value;
};
export const serializeWorkflowArtifact = (value: unknown) =>
  JSON.stringify(convexToJson(withoutUndefined(value)));

export const readWorkflowArtifact = async (
  ref: WorkflowArtifactRef
): Promise<any> => {
  if (!isWorkflowArtifactRef(ref)) {
    throw new Error("invalid_workflow_artifact_reference");
  }
  const url = new URL(await getR2Url(ref.key));
  const base = new URL(env.FILES_BASE ?? "");
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    url.origin !== base.origin ||
    url.pathname !== `/${ref.key}`
  ) {
    throw new Error("invalid_workflow_artifact_origin");
  }
  const response = await fetch(url.toString(), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`workflow_artifact_read_failed:${response.status}`);
  }
  const bytes = await readBodyWithLimit(response, WORKFLOW_ARTIFACT_MAX_BYTES);
  const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    bytes.byteLength !== ref.byteLength ||
    (await hashRawMetadata(json)) !== ref.digest
  ) {
    throw new Error("workflow_artifact_integrity_failure");
  }
  return jsonToConvex(JSON.parse(json));
};

const verifyOwner = async (
  ctx: ActionCtx,
  cardId: Id<"cards">,
  workflowId: string
) => {
  const { workflow } = await ctx.runQuery(
    components.workflow.workflow.getStatus,
    { workflowId: workflowId as any }
  );
  if (workflow.args?.cardId !== cardId || workflow.runResult !== undefined) {
    throw new Error("workflow_artifact_owner_inactive");
  }
  return workflow;
};

export const archiveWorkflowValue = async (
  ctx: ActionCtx,
  card: { _id: Id<"cards">; userId: string },
  workflowId: string | undefined,
  value: unknown
): Promise<any> => {
  if (!workflowId) {
    return value;
  }
  const json = serializeWorkflowArtifact(value);
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength <= WORKFLOW_ARTIFACT_THRESHOLD) {
    return value;
  }
  if (byteLength > WORKFLOW_ARTIFACT_MAX_BYTES) {
    throw new Error("workflow_artifact_too_large");
  }
  const liveCard = await ctx.runQuery(internal.ai.queries.getCardForAI, {
    cardId: card._id,
  });
  if (!liveCard || liveCard.userId !== card.userId) {
    throw new Error("workflow_artifact_card_missing");
  }
  const owner = await verifyOwner(ctx, card._id, workflowId);
  const fields = {
    cardId: card._id,
    userId: card.userId,
    workflowId,
    generationNumber: owner.generationNumber,
    digest: await hashRawMetadata(json),
  };
  const ref: WorkflowArtifactRef = {
    ...fields,
    artifactVersion: 1,
    byteLength,
    key: workflowArtifactKey(fields),
  };
  const register = () =>
    ctx.runMutation(internal.storage.workflowArtifacts.registerArtifact, {
      reference: ref,
    });
  if (!(await register())) {
    throw new Error("workflow_artifact_registration_failed");
  }
  let registeredAfterCopy = false;
  try {
    await putObjectViaFilesWorker({
      body: new TextEncoder().encode(json),
      contentType: "application/json",
      key: ref.key,
      signal: AbortSignal.timeout(30_000),
    });
    const restored = await readWorkflowArtifact(ref);
    if (serializeWorkflowArtifact(restored) !== json) {
      throw new Error("workflow_artifact_roundtrip_failure");
    }
  } finally {
    // Track failed/partial copies too. If teardown raced the upload, this
    // second transaction queues another delete after the final PUT finishes.
    registeredAfterCopy = await register();
  }
  if (!registeredAfterCopy) {
    throw new Error("workflow_artifact_registration_failed");
  }
  return ref;
};

export const hydrateWorkflowValue = async (
  ctx: ActionCtx,
  cardId: Id<"cards">,
  workflowId: string | undefined,
  value: any
) => {
  if (!(value && typeof value === "object" && "artifactVersion" in value)) {
    return value;
  }
  if (
    !isWorkflowArtifactRef(value) ||
    value.cardId !== cardId ||
    value.workflowId !== workflowId
  ) {
    throw new Error("workflow_artifact_owner_mismatch");
  }
  // Generation changes on workflow restart; old journals can still reference an
  // immutable prior-generation artifact owned by this same workflow.
  const card = await ctx.runQuery(internal.ai.queries.getCardForAI, { cardId });
  if (!card || card.userId !== value.userId) {
    throw new Error("workflow_artifact_card_missing");
  }
  await verifyOwner(ctx, cardId, value.workflowId);
  return await readWorkflowArtifact(value);
};

export const MAX_CARD_WORKFLOW_ARTIFACTS = 100;

export const registerArtifactHandler = async (
  ctx: MutationCtx,
  ref: WorkflowArtifactRef
): Promise<boolean> => {
  if (!isWorkflowArtifactRef(ref)) {
    throw new Error("invalid_workflow_artifact_reference");
  }
  const card = await ctx.db.get("cards", ref.cardId);
  let owner: Awaited<ReturnType<typeof verifyOwner>> | undefined;
  try {
    ({ workflow: owner } = await ctx.runQuery(
      components.workflow.workflow.getStatus,
      { workflowId: ref.workflowId as any }
    ));
  } catch (error) {
    if (
      !(error instanceof Error && error.message.includes("Workflow not found"))
    ) {
      throw error;
    }
  }
  const keys = card?.workflowArtifactKeys ?? [];
  if (
    !card ||
    card.userId !== ref.userId ||
    owner?.args?.cardId !== ref.cardId ||
    owner.runResult !== undefined ||
    owner.generationNumber !== ref.generationNumber ||
    (!keys.includes(ref.key) && keys.length >= MAX_CARD_WORKFLOW_ARTIFACTS)
  ) {
    // The verified object never entered a journal; durable deletion is safe,
    // including when card teardown raced the copy or owner was canceled.
    await deleteObject(ctx, ref.key);
    return false;
  }
  if (!keys.includes(ref.key)) {
    await ctx.db.patch("cards", card._id, {
      workflowArtifactKeys: [...keys, ref.key],
    });
  }
  return true;
};

export const registerArtifact = internalMutation({
  args: { reference: v.any() },
  returns: v.boolean(),
  handler: (ctx, { reference }) => registerArtifactHandler(ctx, reference),
});

export const ownedWorkflowArtifactKeys = (
  card: { _id: Id<"cards">; userId: string; workflowArtifactKeys?: string[] },
  workflowId: string,
  generationNumber: number
) => {
  if (
    !(/^[a-z0-9]+$/i.test(workflowId) && Number.isSafeInteger(generationNumber))
  ) {
    throw new Error("invalid_workflow_artifact_owner");
  }
  const prefix = `${buildR2UserPrefix(card.userId)}/${card._id}/workflow-artifacts/${workflowId}/`;
  return (card.workflowArtifactKeys ?? []).filter((key) => {
    if (!key.startsWith(prefix)) {
      return false;
    }
    const match = /^(\d+)\/([a-f0-9]{64})\.json$/.exec(
      key.slice(prefix.length)
    );
    return Boolean(
      match &&
        Number.isSafeInteger(Number(match[1])) &&
        Number(match[1]) <= generationNumber
    );
  });
};

export const deleteRetainedArtifactsHandler = async (
  ctx: MutationCtx,
  args: {
    references: WorkflowArtifactRef[];
    cardId: Id<"cards">;
    workflowId: string;
    generationNumber: number;
  }
) => {
  const { references, cardId, workflowId, generationNumber } = args;
  if (references.length > MAX_CARD_WORKFLOW_ARTIFACTS) {
    throw new Error("workflow_artifact_cleanup_too_large");
  }
  for (const ref of references) {
    if (
      !isWorkflowArtifactRef(ref) ||
      ref.cardId !== cardId ||
      ref.workflowId !== workflowId ||
      ref.generationNumber > generationNumber
    ) {
      throw new Error("invalid_workflow_artifact_cleanup");
    }
  }
  const card = await ctx.db.get("cards", cardId);
  const owned = card
    ? ownedWorkflowArtifactKeys(card, workflowId, generationNumber)
    : [];
  const keys = [...new Set([...owned, ...references.map((ref) => ref.key)])];
  for (const key of keys) {
    await deleteObject(ctx, key);
  }
  if (card && owned.length) {
    const remaining = (card.workflowArtifactKeys ?? []).filter(
      (key) => !owned.includes(key)
    );
    await ctx.db.patch("cards", cardId, {
      workflowArtifactKeys: remaining.length ? remaining : undefined,
    });
  }
  return null;
};

export const deleteRetainedArtifacts = internalMutation({
  args: {
    references: v.array(v.any()),
    cardId: v.id("cards"),
    workflowId: v.string(),
    generationNumber: v.number(),
  },
  returns: v.null(),
  handler: deleteRetainedArtifactsHandler,
});

export const collectWorkflowArtifacts = (
  value: unknown,
  owner: { cardId: string; workflowId: string; generationNumber: number }
): WorkflowArtifactRef[] => {
  const refs = new Map<string, WorkflowArtifactRef>();
  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") {
      return;
    }
    if ("artifactVersion" in item) {
      if (
        !isWorkflowArtifactRef(item) ||
        item.cardId !== owner.cardId ||
        item.workflowId !== owner.workflowId ||
        item.generationNumber > owner.generationNumber
      ) {
        throw new Error("workflow_artifact_cleanup_owner_mismatch");
      }
      refs.set(item.key, item);
      if (refs.size > 100) {
        throw new Error("workflow_artifact_cleanup_too_large");
      }
      return;
    }
    for (const child of Object.values(item)) {
      visit(child);
    }
  };
  visit(value);
  return [...refs.values()];
};
