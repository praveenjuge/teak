import { internal } from "@teak/convex/_generated/api";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { DnsResolver, PinnedFetch } from "@teak/convex/linkMetadata/ssrf";
import { PODCAST_LOOKUP_MAX_BYTES } from "@teak/convex/workflows/steps/podcast/resolveEnclosure";
import {
  buildCardObjectKey,
  FILES_UPLOAD_MAX_BYTES,
  filesUserKeyRoot,
} from "@teak/files-protocol";
import { type AiGateReader, createAiGateReader } from "../../ai/aiGate";
import { type ConvexRpc, createConvexRpc } from "../../convexRpc";
import {
  createContainerPinnedFetch,
  createContainerStreamingFetch,
  createDohResolver,
} from "../../media/pinnedHop";
import type { FilesOpCaller } from "../deps";
import { callFilesOp } from "../filesOps";
import type { BackgroundEnv } from "../runtime";
import { EPISODE_DOWNLOAD_TIMEOUT_MS } from "./podcastAudio";

export interface CardProcessingDeps {
  /** The account's AI gate, reused for up to a minute (`src/ai/aiGate.ts`). */
  aiGate: AiGateReader;
  convex: ConvexRpc;
  filesOp: FilesOpCaller;
  pinnedFetch: PinnedFetch;
  /**
   * The same hops for podcasts: a show's lookup and feed, which run past the
   * default hop's 1 MiB, and the episode's audio, streamed rather than held.
   */
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
