import { internal } from "@teak/convex/_generated/api";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { DnsResolver, PinnedFetch } from "@teak/convex/linkMetadata/ssrf";
import { buildCardObjectKey, filesUserKeyRoot } from "@teak/files-protocol";
import { type ConvexRpc, createConvexRpc } from "../../convexRpc";
import { createContainerPinnedFetch, createDohResolver } from "../../pinnedHop";
import type { FilesOpCaller } from "../deps";
import { callFilesOp } from "../filesOps";
import type { BackgroundEnv } from "../runtime";

export interface CardProcessingDeps {
  convex: ConvexRpc;
  filesOp: FilesOpCaller;
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

export type StageKey =
  | "categorize"
  | "classify"
  | "metadata"
  | "renderables"
  | "screenshot";

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
