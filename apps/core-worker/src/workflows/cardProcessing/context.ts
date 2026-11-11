import { internal } from "@teak/convex/_generated/api";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  buildCardObjectKey,
  type CardRunStage,
  FILES_UPLOAD_MAX_BYTES,
  filesUserKeyRoot,
  WORKFLOW_RPC_MAX_BATCH_OPS,
} from "@teak/files-protocol";
import type { DnsResolver, PinnedFetch } from "@teak/files-protocol/ssrf";
import type { FunctionArgs } from "convex/server";
import { type AiGateReader, createAiGateReader } from "../../ai/aiGate";
import { batchOp, type ConvexRpc, createConvexRpc } from "../../convexRpc";
import { createDohResolver } from "../../dns";
import {
  createContainerPinnedFetch,
  createContainerStreamingFetch,
} from "../../media/pinnedHop";
import type { OpCaller } from "../deps";
import { supersededReason } from "../errors";
import { callFilesOp } from "../filesOps";
import type { BackgroundEnv } from "../runtime";
import { EPISODE_DOWNLOAD_TIMEOUT_MS } from "./podcastAudio";
import { PODCAST_LOOKUP_MAX_BYTES } from "./podcastFeed/resolveEnclosure";

export interface CardProcessingDeps {
  aiGate: AiGateReader;
  convex: ConvexRpc;
  filesOp: OpCaller;
  pinnedFetch: PinnedFetch;
  podcastFetch: { episode: PinnedFetch; feed: PinnedFetch };
  resolveDns: DnsResolver;
}

export const createCardProcessingDeps = (
  env: BackgroundEnv,
  convexSiteUrl: string,
  overrides: Partial<CardProcessingDeps> = {}
): CardProcessingDeps => {
  const convex = overrides.convex ?? createConvexRpc(env, convexSiteUrl);
  return {
    aiGate: overrides.aiGate ?? createAiGateReader(convex, convexSiteUrl),
    convex,
    filesOp: overrides.filesOp ?? ((spec) => callFilesOp(env, spec)),
    pinnedFetch: overrides.pinnedFetch ?? createContainerPinnedFetch(env),
    podcastFetch: overrides.podcastFetch ?? {
      episode: createContainerStreamingFetch(env, {
        maxBytes: FILES_UPLOAD_MAX_BYTES,
        timeoutMs: EPISODE_DOWNLOAD_TIMEOUT_MS,
      }),
      feed: createContainerPinnedFetch(env, {
        maxBytes: PODCAST_LOOKUP_MAX_BYTES,
      }),
    },
    resolveDns: overrides.resolveDns ?? createDohResolver(),
  };
};

export interface CardJob {
  cardId: Id<"cards">;
  convexSiteUrl: string;
  deps: CardProcessingDeps;
  env: BackgroundEnv;
  refresh?: boolean;
  rev: number;
}

export type CardDoc = Doc<"cards">;

export interface LoadedCard {
  card: CardDoc;
  keyPrefix: string;
}

export const guardOf = (job: CardJob) => ({
  guard: { cardId: job.cardId, rev: job.rev },
});

export const loadCard = (job: CardJob): Promise<LoadedCard | null> =>
  job.deps.convex.query(internal.card.processingRpc.getCardForProcessing, {
    cardId: job.cardId,
  }) as Promise<LoadedCard | null>;

/**
 * A write a step hands to the next step instead of making its own call: the
 * next step makes it first thing, in the batch that reads the card, so the
 * card reads it back. Kept in the step's result, so a replay still has it.
 */
export type HeldWrite =
  | {
      args: FunctionArgs<typeof internal.linkMetadata.updateCardMetadata>;
      kind: "link_metadata";
    }
  | {
      args: FunctionArgs<
        typeof internal.workflows.steps.categorization.mutations.updateCategorization
      >;
      kind: "categorization";
    };

/** Step results stay small; a bigger write is made at once instead. */
export const HELD_WRITE_MAX_BYTES = 12 * 1024;

export const fitsHeld = (write: HeldWrite) =>
  new TextEncoder().encode(JSON.stringify(write)).byteLength <=
  HELD_WRITE_MAX_BYTES;

const heldOp = (write: HeldWrite) =>
  write.kind === "link_metadata"
    ? batchOp.mutation(internal.linkMetadata.updateCardMetadata, write.args)
    : batchOp.mutation(
        internal.workflows.steps.categorization.mutations.updateCategorization,
        write.args
      );

/**
 * The card, with `stages` marked in progress in the same call and
 * transaction, after the writes an earlier step held; null when the card is
 * gone. A newer run's revision still throws, as any guarded write does.
 */
export const loadAndMark = async (
  job: CardJob,
  stages: CardRunStage[],
  held: readonly HeldWrite[] = []
): Promise<LoadedCard | null> => {
  try {
    const results = await job.deps.convex.batch(
      [
        ...held.map(heldOp),
        batchOp.query(internal.card.processingRpc.getCardForProcessing, {
          cardId: job.cardId,
        }),
        ...(stages.length > 0
          ? [
              batchOp.mutation(
                internal.card.processingRpc.markStagesInProgress,
                { cardId: job.cardId, stages }
              ),
            ]
          : []),
      ],
      guardOf(job)
    );
    return results[held.length] as LoadedCard | null;
  } catch (error) {
    if (supersededReason(error) === "card_missing") {
      return null;
    }
    throw error;
  }
};

export const markInProgress = async (
  job: CardJob,
  stages: CardRunStage[]
): Promise<void> => {
  await job.deps.convex.mutation(
    internal.card.processingRpc.markStagesInProgress,
    { cardId: job.cardId, stages },
    guardOf(job)
  );
};

export const objectKey = (
  loaded: LoadedCard,
  args: { cardId?: string; fileName?: string; objectId?: string; role: string }
): string =>
  buildCardObjectKey({
    envPrefix: loaded.keyPrefix,
    userId: loaded.card.userId,
    ...args,
  });

export const isKeyInUserNamespace = (keyPrefix: string, key: string) =>
  key.startsWith(filesUserKeyRoot(keyPrefix));

export const ensureObjectOwnership = async (
  job: CardJob,
  userId: string,
  key: string
): Promise<void> => {
  await ensureObjectsOwnership(job, userId, [key]);
};

/**
 * Registers the keys a step is about to upload, all in one call, before
 * any upload: an account being deleted refuses them, and deletion finds
 * every object registered here.
 */
export const ensureObjectsOwnership = async (
  job: CardJob,
  userId: string,
  keys: readonly string[]
): Promise<void> => {
  if (keys.length === 0) {
    return;
  }
  const unique = [...new Set(keys)];
  for (
    let start = 0;
    start < unique.length;
    start += WORKFLOW_RPC_MAX_BATCH_OPS
  ) {
    const chunk = unique.slice(start, start + WORKFLOW_RPC_MAX_BATCH_OPS);
    const registered =
      chunk.length === 1
        ? [
            await job.deps.convex.mutation(
              internal.storage.ownership.registerObject,
              { key: chunk[0] as string, userId },
              guardOf(job)
            ),
          ]
        : await job.deps.convex.batch(
            chunk.map((key) =>
              batchOp.mutation(internal.storage.ownership.registerObject, {
                key,
                userId,
              })
            ),
            guardOf(job)
          );
    if (!registered.every(Boolean)) {
      throw new Error("account_storage_write_denied");
    }
  }
};
