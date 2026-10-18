import type { FilesErrorCode, FilesOp } from "@teak/files-protocol";
import { createFetcherHandler } from "../../fetcher/src/handler";
import { createConvexRpc } from "../convexRpc";
import type {
  CardJob,
  CardProcessingDeps,
} from "../workflows/cardProcessing/context";
import type { FilesOpCaller } from "../workflows/deps";
import type { FilesOpOutcome } from "../workflows/filesOps";
import type { BackgroundEnv } from "../workflows/runtime";
import {
  createFakeConvex,
  FakeConvexError,
  type FakeHandler,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
} from "./fakeConvex";

// A card-processing test bench: one card in a fake Convex deployment that
// answers the RPCs card processing makes the way the real functions do,
// enforces the revision guard, and records every call; and fake Files ops.

export const CARD_ID = "k57card0000000000000000000000001";
export const USER_ID = "user_1";

export type FakeCard = Record<string, unknown> & {
  _id: string;
  processingRev?: number;
  processingStatus?: Record<string, Record<string, unknown>>;
  type: string;
  userId: string;
};

export const makeCard = (fields: Partial<FakeCard> = {}): FakeCard => ({
  _creationTime: Date.now() - 5000,
  _id: CARD_ID,
  content: "",
  createdAt: Date.now() - 5000,
  processingRev: 1,
  processingStatus: {
    categorize: { status: "completed" },
    classify: { status: "pending" },
    metadata: { status: "pending" },
    renderables: { status: "completed" },
  },
  type: "text",
  userId: USER_ID,
  ...fields,
});

const merge = (card: FakeCard, stages: Record<string, unknown> | undefined) => {
  card.processingStatus = {
    ...(card.processingStatus ?? {}),
    ...((stages ?? {}) as FakeCard["processingStatus"]),
  };
};

/**
 * A fake deployment holding `card`. Pass handlers to replace or add
 * functions; `card` is mutated in place as mutations land.
 */
export const createCardConvex = (
  card: FakeCard | null,
  handlers: Record<string, FakeHandler> = {}
) => {
  const stageWrites: Array<{ stage: string; status: string }> = [];
  const record = (stages: Record<string, unknown> | undefined) => {
    for (const [stage, value] of Object.entries(stages ?? {})) {
      stageWrites.push({
        stage,
        status: String((value as { status?: unknown }).status),
      });
    }
  };
  const write =
    (name: string, fn: FakeHandler): FakeHandler =>
    (args, request) => {
      if (!card) {
        throw new FakeConvexError("card_missing", "card_missing");
      }
      if (request.guard && request.guard.rev !== (card.processingRev ?? 0)) {
        throw new FakeConvexError(
          `stale revision for ${name}`,
          "stale_processing_revision"
        );
      }
      return fn(args, request);
    };
  const base: Record<string, FakeHandler> = {
    "adminAccess:getAiGate": () => "allowed",
    "adminAccess:isLinkFetchPaused": () => false,
    "ai/mutations:updateCardProcessing": write(
      "updateCardProcessing",
      (args) => {
        const stages = Object.fromEntries(
          Object.entries(
            args.processingStatus as Record<string, unknown>
          ).filter(
            ([stage]) =>
              !args.onlyIfInProgress ||
              card?.processingStatus?.[stage]?.status === "in_progress"
          )
        );
        if (args.onlyIfInProgress && Object.keys(stages).length === 0) {
          return false;
        }
        record(stages);
        merge(card as FakeCard, stages);
        return true;
      }
    ),
    "card/documentText:saveDocumentText": write("saveDocumentText", (args) => {
      Object.assign(card as FakeCard, {
        documentTextKey: args.key,
        hasExtractedText: true,
      });
      return true;
    }),
    "card/processingRpc:getCardForProcessing": () =>
      card ? { card, keyPrefix: "" } : null,
    "card/processingRpc:markStagesInProgress": write(
      "markStagesInProgress",
      (args) => {
        const stages = Object.fromEntries(
          (args.stages as string[]).map((stage) => [
            stage,
            { status: "in_progress" },
          ])
        );
        record(stages);
        merge(card as FakeCard, stages);
        return true;
      }
    ),
    "linkMetadata:getCardForLinkFetch": () =>
      card
        ? {
            processingStatus: card.processingStatus?.classify
              ? { classify: { status: card.processingStatus.classify.status } }
              : undefined,
            type: card.type,
            url: card.url,
            userId: card.userId,
          }
        : null,
    "linkMetadata:getCardForScreenshot": () =>
      card
        ? {
            metadata: (card.metadata as Record<string, unknown> | undefined)
              ?.linkPreview
              ? {
                  linkPreview: (card.metadata as { linkPreview: unknown })
                    .linkPreview,
                }
              : undefined,
            type: card.type,
            url: card.url,
            userId: card.userId,
          }
        : null,
    "linkMetadata:updateCardMetadata": write("updateCardMetadata", (args) => {
      const previous = (
        (card as FakeCard).metadata as
          | { linkPreview?: { status?: string } }
          | undefined
      )?.linkPreview;
      // Like Convex: a refresh that can't read the page keeps the preview.
      if (
        args.refresh === true &&
        args.status === "failed" &&
        previous?.status === "success"
      ) {
        Object.assign(card as FakeCard, { metadataStatus: "completed" });
        return null;
      }
      Object.assign(card as FakeCard, {
        metadata: {
          ...((card as FakeCard).metadata as object),
          linkPreview: args.linkPreview,
        },
        metadataStatus: args.status,
      });
      return null;
    }),
    "linkMetadata:updateCardScreenshot": write(
      "updateCardScreenshot",
      (args) => {
        const metadata = (card as FakeCard).metadata as
          | { linkPreview?: object }
          | undefined;
        Object.assign(card as FakeCard, {
          metadata: {
            ...metadata,
            linkPreview: {
              ...metadata?.linkPreview,
              screenshotStorageKey: args.screenshotStorageKey,
            },
          },
        });
        return null;
      }
    ),
    "storage/ownership:registerObject": write("registerObject", () => true),
    "workflowDispatch:complete": () => null,
    "workflows/aiMetadata/mutations:updateCardAI": write(
      "updateCardAI",
      (args) => {
        const { cardId: _cardId, processingStatus, ...fields } = args;
        record(processingStatus as Record<string, unknown>);
        merge(card as FakeCard, processingStatus as Record<string, unknown>);
        Object.assign(card as FakeCard, fields);
        return true;
      }
    ),
    "workflows/aiMetadata/mutations:updateCardColors": write(
      "updateCardColors",
      (args) => {
        Object.assign(card as FakeCard, { colors: args.colors });
        return null;
      }
    ),
    "workflows/steps/categorization/mutations:updateCategorization": write(
      "updateCategorization",
      (args) => {
        record({ categorize: { status: "completed" } });
        merge(card as FakeCard, { categorize: { status: "completed" } });
        Object.assign(card as FakeCard, {
          metadata: {
            ...((card as FakeCard).metadata as object),
            linkCategory: args.metadata,
          },
        });
        return null;
      }
    ),
    "workflows/steps/classificationMutations:recordClassification": write(
      "recordClassification",
      (args) => {
        const stages: Record<string, unknown> = {
          classify: { confidence: args.confidence, status: "completed" },
        };
        if (typeof args.type === "string") {
          (card as FakeCard).type = args.type;
          stages.categorize = {
            status: args.type === "link" ? "pending" : "completed",
          };
          stages.metadata = { status: "pending" };
          stages.renderables = {
            status: ["image", "video", "document"].includes(args.type)
              ? "pending"
              : "completed",
          };
          if (args.type === "link") {
            (card as FakeCard).metadataStatus = "pending";
          }
        }
        record(stages);
        merge(card as FakeCard, stages);
        return null;
      }
    ),
    "workflows/steps/podcast/mutations:takePodcastTranscriptSlot": () => true,
    "workflows/steps/podcast/mutations:trackPodcastAudio": write(
      "trackPodcastAudio",
      (args) => {
        const keys = (
          ((card as FakeCard).workflowArtifactKeys as string[] | undefined) ??
          []
        ).filter((key) => key !== args.key);
        (card as FakeCard).workflowArtifactKeys = args.stored
          ? [...keys, args.key as string]
          : keys;
        return true;
      }
    ),
    "workflows/steps/renderables/mutations:markCardRenderablesFailed": write(
      "markCardRenderablesFailed",
      (args) => {
        const stages = {
          renderables: { error: args.error, status: "failed" },
        };
        record(stages);
        merge(card as FakeCard, stages);
        return null;
      }
    ),
    "workflows/steps/renderables/mutations:updateCardFileMetadata": write(
      "updateCardFileMetadata",
      () => null
    ),
    "workflows/steps/renderables/mutations:updateCardFilePreview": write(
      "updateCardFilePreview",
      () => null
    ),
    "workflows/steps/renderables/mutations:updateCardMediaFacts": write(
      "updateCardMediaFacts",
      () => null
    ),
    "workflows/steps/renderables/mutations:updateCardThumbnail": write(
      "updateCardThumbnail",
      (args) => {
        Object.assign(card as FakeCard, { thumbnailKey: args.thumbnailKey });
        return null;
      }
    ),
  };
  const fake = createFakeConvex({ ...base, ...handlers });
  return { ...fake, stageWrites };
};

export type OpAnswer =
  | { data: unknown }
  | { fallback: FilesErrorCode; message?: string }
  | { throws: Error };

/** Fake Files ops: answer by op name; every call is recorded. */
export const createFakeOps = (
  answers: Partial<
    Record<FilesOp, OpAnswer | ((params: Record<string, unknown>) => OpAnswer)>
  >
) => {
  const calls: Array<{ op: FilesOp; params: Record<string, unknown> }> = [];
  const ops: FilesOpCaller = <T>(spec: {
    op: FilesOp;
    params: Record<string, unknown>;
  }): Promise<FilesOpOutcome<T>> => {
    calls.push({ op: spec.op, params: spec.params });
    const entry = answers[spec.op];
    if (!entry) {
      return Promise.reject(new Error(`fake ops: no answer for ${spec.op}`));
    }
    const answer = typeof entry === "function" ? entry(spec.params) : entry;
    if ("throws" in answer) {
      return Promise.reject(answer.throws);
    }
    if ("fallback" in answer) {
      return Promise.resolve({
        code: answer.fallback,
        kind: "fallback",
        message: answer.message ?? answer.fallback,
      });
    }
    return Promise.resolve({ data: answer.data as T, kind: "ok" });
  };
  return { calls, ops, opsCalled: () => calls.map((call) => call.op) };
};

/** A Workers AI metadata op answer, as `generate-text-metadata` gives it. */
export const textMetadataAnswer = (
  tags: string[] = ["design", "notes"],
  summary = "A short summary"
): OpAnswer => ({
  data: {
    summary,
    tags,
    usage: { inputTokens: 120, outputTokens: 30 },
    validationRetryCount: 0,
  },
});

/** An in-memory R2 bucket with the methods card processing uses. */
export const createMemoryBucket = () => {
  const objects = new Map<string, string>();
  const bucket = {
    get: (key: string) => {
      const value = objects.get(key);
      if (value === undefined) {
        return Promise.resolve(null);
      }
      const bytes = new TextEncoder().encode(value);
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(bytes.buffer),
        body: new Response(bytes).body,
        size: bytes.byteLength,
      });
    },
    put: (key: string, value: string) => {
      objects.set(key, value);
      return Promise.resolve({ key });
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
};

export const testEnv = (fields: Partial<BackgroundEnv> = {}): BackgroundEnv =>
  ({
    ...fakeConvexEnv,
    BUCKET: createMemoryBucket().bucket,
    ...fields,
  }) as BackgroundEnv;

export const noNetwork = {
  pinnedFetch: () => Promise.reject(new Error("unexpected network request")),
  resolveDns: () => Promise.resolve(["93.184.216.34"]),
} satisfies Pick<CardProcessingDeps, "pinnedFetch" | "resolveDns">;

/** Deps for the fake deployment and ops. */
export const testDeps = (
  env: BackgroundEnv,
  fetcher: typeof fetch,
  ops: FilesOpCaller,
  extra: Partial<CardProcessingDeps> = {}
): CardProcessingDeps => ({
  convex: createConvexRpc(env, TEST_CONVEX_SITE_URL, fetcher),
  filesOp: ops,
  ...noNetwork,
  ...extra,
});

export const testJob = (
  env: BackgroundEnv,
  deps: CardProcessingDeps,
  rev = 1
): CardJob => ({
  cardId: CARD_ID as CardJob["cardId"],
  convexSiteUrl: TEST_CONVEX_SITE_URL,
  deps,
  env,
  rev,
});

/**
 * The link fetcher Container's real handler behind a fake Durable Object
 * namespace. `route` answers the upstream requests it makes (404 when it
 * returns nothing); every upstream URL is recorded.
 */
export const createContainerNetwork = (
  route: (url: string, init: RequestInit) => Response | undefined
) => {
  const requests: Array<{ addresses: string[]; url: string }> = [];
  const handle = createFetcherHandler({
    pinnedFetch: (url, addresses, init) => {
      requests.push({ addresses, url });
      return Promise.resolve(
        route(url, init) ?? new Response("Not found", { status: 404 })
      );
    },
    resolveDns: () =>
      Promise.reject(new Error("a hop never resolves names in the Container")),
  });
  const namespace = {
    get: () => ({ fetch: (request: Request) => handle(request) }),
    idFromName: (name: string) => name,
  } as unknown as DurableObjectNamespace;
  return {
    env: { LINK_FETCHER: namespace, LINK_FETCHER_INSTANCES: "1" },
    requests,
  };
};
