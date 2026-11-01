import { internal } from "@teak/convex/_generated/api";
import { buildRawSelectorMap } from "@teak/convex/workflows/steps/categorization/enrichment";
import { resolveEnclosure } from "@teak/convex/workflows/steps/podcast/resolveEnclosure";
import { runWithAiUsage } from "../../ai/aiUsage";
import { gatedEnv } from "../filesOps";
import type { WorkflowTelemetry } from "../telemetry";
import {
  type GeneratedMetadata,
  generateLinkMetadata,
  sanitizeTranscript,
  saveCardAi,
} from "./aiMetadata";
import {
  type CardJob,
  ensureObjectOwnership,
  guardOf,
  type LoadedCard,
  loadCard,
  objectKey,
} from "./context";
import { transcribeStoredAudio } from "./files";
import { buildLinkContentParts } from "./metadata";
import { downloadEpisodeToR2 } from "./podcastAudio";
import { hydrateArchivedMetadata } from "./rawMetadata";

export type PodcastMissReason =
  | "ai_off"
  | "already_transcribed"
  | "blocked"
  | "no_enclosure"
  | "no_speech"
  | "not_audio"
  | "not_podcast"
  | "rate_limited"
  | "too_large"
  | "worker_declined";

export type PodcastOutcome =
  | { reason: PodcastMissReason; transcribed: false }
  | { transcribed: true };

const miss = (reason: PodcastMissReason): PodcastOutcome => ({
  reason,
  transcribed: false,
});

export const isPodcastLink = (
  cardType: string | undefined,
  category: string | undefined
): boolean => cardType === "link" && category === "podcast";

const pageData = async (job: CardJob, loaded: LoadedCard) => {
  const { card } = loaded;
  const hydrated = await hydrateArchivedMetadata(job.env, loaded.keyPrefix, {
    _id: card._id,
    metadata: {
      ...(card.metadata?.linkCategory
        ? { linkCategory: card.metadata.linkCategory }
        : {}),
      ...(card.metadata?.linkPreview
        ? { linkPreview: card.metadata.linkPreview }
        : {}),
    },
    userId: card.userId,
  }).catch(() => ({ ...card, metadata: card.metadata ?? {} }));
  const preview =
    hydrated.metadata.linkPreview?.status === "success"
      ? (hydrated.metadata.linkPreview as {
          raw?: Parameters<typeof buildRawSelectorMap>[0];
          title?: string;
        })
      : undefined;
  const linkCategory = hydrated.metadata.linkCategory as
    | { raw?: { structured?: unknown }; sourceUrl?: string }
    | undefined;
  const structured =
    linkCategory?.sourceUrl === card.url
      ? linkCategory?.raw?.structured
      : undefined;
  return {
    entities: structured ? [structured] : [],
    rawMap: buildRawSelectorMap(preview?.raw),
    title: preview?.title,
  };
};

export interface PodcastEpisode {
  audioUrl: string;
}

interface EligibleCard {
  loaded: LoadedCard;
  url: string;
}

const loadEligibleCard = async (
  job: CardJob,
  options: { keepTranscript?: boolean }
): Promise<EligibleCard | PodcastOutcome> => {
  const loaded = await loadCard(job);
  const card = loaded?.card;
  if (
    !(
      loaded &&
      card?.url &&
      !card.isDeleted &&
      isPodcastLink(card.type, card.metadata?.linkCategory?.category)
    )
  ) {
    return miss("not_podcast");
  }
  // Convex keeps a transcript in its text rows, with only its length on the card.
  if (
    options.keepTranscript &&
    (card.aiTranscript || card.aiTranscriptCharCount)
  ) {
    return miss("already_transcribed");
  }
  if ((await job.deps.aiGate(card.userId)) !== "allowed") {
    return miss("ai_off");
  }
  return { loaded, url: card.url };
};

/**
 * Finds the episode's public audio and takes one of the owner's hourly
 * transcription slots. Card processing runs it in a step of its own, so the
 * transcription step's retries reuse the slot rather than take another.
 */
export const findPodcastEpisode = async (
  job: CardJob,
  options: { keepTranscript?: boolean } = {}
): Promise<PodcastEpisode | PodcastOutcome> => {
  const eligible = await loadEligibleCard(job, options);
  if ("transcribed" in eligible) {
    return eligible;
  }
  const { loaded, url } = eligible;
  const page = await pageData(job, loaded);
  const enclosure = await resolveEnclosure(
    { ...page, sourceUrl: url },
    { pinnedFetch: job.deps.podcastFetch.feed, resolveDns: job.deps.resolveDns }
  );
  if (!enclosure) {
    return miss("no_enclosure");
  }
  const allowed = await job.deps.convex.mutation(
    internal.workflows.steps.podcast.mutations.takePodcastTranscriptSlot,
    { userId: loaded.card.userId }
  );
  if (!allowed) {
    return miss("rate_limited");
  }
  return { audioUrl: enclosure.url };
};

/**
 * Transcribes an episode {@link findPodcastEpisode} found and stores the
 * transcript, summary and tags. A busy renderer throws so the step retries;
 * everything else is a logged miss.
 */
export const transcribeFoundEpisode = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  episode: PodcastEpisode,
  options: { keepTranscript?: boolean } = {}
): Promise<PodcastOutcome> => {
  const eligible = await loadEligibleCard(job, options);
  if ("transcribed" in eligible) {
    return eligible;
  }
  const { loaded, url } = eligible;
  const { card } = loaded;

  const key = objectKey(loaded, {
    cardId: job.cardId,
    fileName: "episode",
    role: "podcast-audio",
  });
  // Registered and on the card before anything is written, so account and
  // card deletion find it while it exists.
  await ensureObjectOwnership(job, card.userId, key);
  await job.deps.convex.mutation(
    internal.workflows.steps.podcast.mutations.trackPodcastAudio,
    { cardId: job.cardId, key, stored: true },
    guardOf(job)
  );
  try {
    // Through the deletion gate, so account deletion can fence the key and
    // abort an upload in flight.
    const download = await downloadEpisodeToR2(
      gatedEnv(job.env).BUCKET,
      key,
      episode.audioUrl,
      {
        pinnedFetch: job.deps.podcastFetch.episode,
        resolveDns: job.deps.resolveDns,
      }
    );
    if (!download.stored) {
      return miss(download.reason);
    }
    return await runWithAiUsage(
      {
        cardId: job.cardId,
        convexSiteUrl: job.convexSiteUrl,
        userId: card.userId,
      },
      async () => {
        const { processed, text } = await transcribeStoredAudio(
          job,
          telemetry,
          { mimeType: download.contentType, sourceKey: key }
        );
        if (!processed) {
          return miss("worker_declined");
        }
        const transcript = sanitizeTranscript(text);
        if (!transcript) {
          return miss("no_speech");
        }
        let generated: Partial<GeneratedMetadata> = {};
        try {
          const content = buildLinkContentParts(card, undefined, transcript);
          const result = await generateLinkMetadata(
            job,
            telemetry,
            content.join("\n"),
            url
          );
          generated = result;
        } catch (error) {
          console.warn("[cardProcessing/podcast] summary not regenerated", {
            cardId: job.cardId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const writesText = Boolean(
          generated.aiSummary || generated.aiTags?.length
        );
        await saveCardAi(job, {
          aiTranscript: transcript,
          cardId: job.cardId,
          ...(generated.aiSummary ? { aiSummary: generated.aiSummary } : {}),
          ...(generated.aiTags?.length ? { aiTags: generated.aiTags } : {}),
          ...(writesText && generated.aiLanguage
            ? { aiLanguage: generated.aiLanguage }
            : {}),
        });
        return { transcribed: true } as const;
      }
    );
  } finally {
    // The audio is never kept: deleted first, then forgotten on the card.
    // One that couldn't be deleted stays listed, for card deletion.
    let deleted = false;
    try {
      await job.env.BUCKET.delete(key);
      deleted = true;
    } catch (error) {
      console.warn("[cardProcessing/podcast] episode audio not deleted", {
        cardId: job.cardId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    // Not guarded: forgetting a deleted object is right whichever run owns
    // the card now, and an edit mid-transcription must not leave it listed.
    if (deleted) {
      await job.deps.convex
        .mutation(
          internal.workflows.steps.podcast.mutations.trackPodcastAudio,
          { cardId: job.cardId, key, stored: false }
        )
        .catch(() => undefined);
    }
  }
};

export const transcribePodcastEpisode = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  options: { keepTranscript?: boolean } = {}
): Promise<PodcastOutcome> => {
  const found = await findPodcastEpisode(job, options);
  return "audioUrl" in found
    ? await transcribeFoundEpisode(job, telemetry, found, options)
    : found;
};
