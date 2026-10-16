import { internal } from "@teak/convex/_generated/api";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { DnsResolver, PinnedFetch } from "@teak/convex/linkMetadata/ssrf";
import { buildCardObjectKey, filesUserKeyRoot } from "@teak/files-protocol";
import { type ConvexRpc, createConvexRpc } from "../../convexRpc";
import { createContainerPinnedFetch, createDohResolver } from "../../pinnedHop";
import type { FilesOpCaller } from "../deps";
import { callFilesOp } from "../filesOps";
import type { BackgroundEnv } from "../runtime";

/** The boundaries card processing reaches, replaceable in tests. */
export interface CardProcessingDeps {
  convex: ConvexRpc;
  /** Files ops, run in-process. */
  filesOp: FilesOpCaller;
  /** Hops to user URLs, pinned to the addresses `resolveDns` checked. */
  pinnedFetch: PinnedFetch;
  resolveDns: DnsResolver;
}

export const createCardProcessingDeps = (
  env: BackgroundEnv,
  convexSiteUrl: string,
  overrides: Partial<CardProcessingDeps> = {}
): CardProcessingDeps => ({
  convex: overrides.convex ?? createConvexRpc(env, convexSiteUrl),
  filesOp: overrides.filesOp ?? ((spec) => callFilesOp(env, spec)),
  pinnedFetch: overrides.pinnedFetch ?? createContainerPinnedFetch(env),
  resolveDns: overrides.resolveDns ?? createDohResolver(),
});

/** One card's processing run (or AI backfill message). */
export interface CardJob {
  cardId: Id<"cards">;
  convexSiteUrl: string;
  deps: CardProcessingDeps;
  env: BackgroundEnv;
  /** The processing revision the run owns; every write is guarded by it. */
  rev: number;
}

export type CardDoc = Doc<"cards">;

export interface LoadedCard {
  card: CardDoc;
  /** The deployment's R2 key prefix: "" in production, "dev/" in dev. */
  keyPrefix: string;
}

/** The write guard: refused once an edit replaces this run's revision. */
export const guardOf = (job: CardJob) => ({
  guard: { cardId: job.cardId, rev: job.rev },
});

export const loadCard = (job: CardJob): Promise<LoadedCard | null> =>
  job.deps.convex.query(internal.card.processingRpc.getCardForProcessing, {
    cardId: job.cardId,
  }) as Promise<LoadedCard | null>;

export type StageKey =
  | "categorize"
  | "classify"
  | "metadata"
  | "renderables"
  | "screenshot";

/** Marks the stages a step is about to run as in progress. */
export const markInProgress = async (
  job: CardJob,
  stages: StageKey[]
): Promise<void> => {
  await job.deps.convex.mutation(
    internal.card.processingRpc.markStagesInProgress,
    { cardId: job.cardId, stages },
    guardOf(job)
  );
};

export const objectKey = (
  loaded: LoadedCard,
  args: { cardId?: string; fileName?: string; role: string }
): string =>
  buildCardObjectKey({
    envPrefix: loaded.keyPrefix,
    userId: loaded.card.userId,
    ...args,
  });

export const isKeyInUserNamespace = (keyPrefix: string, key: string) =>
  key.startsWith(filesUserKeyRoot(keyPrefix));

/**
 * Registers the card owner's claim on an object before anything writes it,
 * so account deletion finds every object it must remove.
 */
export const ensureObjectOwnership = async (
  job: CardJob,
  userId: string,
  key: string
): Promise<void> => {
  const registered = await job.deps.convex.mutation(
    internal.storage.ownership.registerObject,
    { key, userId },
    guardOf(job)
  );
  if (!registered) {
    throw new Error("account_storage_write_denied");
  }
};
