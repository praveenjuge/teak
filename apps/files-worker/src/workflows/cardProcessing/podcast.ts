import { internal } from "@teak/convex/_generated/api";
import { buildRawSelectorMap } from "@teak/convex/workflows/steps/categorization/enrichment";
import { resolveEnclosure } from "@teak/convex/workflows/steps/podcast/resolveEnclosure";
import { runWithAiUsage } from "../../aiUsage";
import type { WorkflowTelemetry } from "../telemetry";
import { generateLinkMetadata, sanitizeTranscript } from "./aiMetadata";
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

// A podcast episode link's transcript: the episode's public audio is found
// (og:audio, JSON-LD, Apple's lookup, the show's feed), streamed into a
// temporary object, transcribed with Whisper, and deleted. The summary and
// tags are then written from what is said (owner decision). It runs after
// the card's processing completes and never fails the card: a miss logs its
// reason.

export type PodcastMissReason =
  | "ai_off"
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

/** Whether processing should go on to transcribe this card's episode. */
export const isPodcastLink = (
  cardType: string | undefined,
  category: string | undefined
): boolean => cardType === "link" && category === "podcast";

/** The page's scraped tags and stored JSON-LD, read back when archived. */
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
  }).catch(() => card);
  const preview =
    hydrated.metadata?.linkPreview?.status === "success"
      ? (hydrated.metadata.linkPreview as {
          raw?: Parameters<typeof buildRawSelectorMap>[0];
          title?: string;
        })
      : undefined;
  const linkCategory = hydrated.metadata?.linkCategory as
    | { raw?: { structured?: unknown }; sourceUrl?: string }
    | undefined;
  // JSON-LD stored for another URL describes another page.
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

/**
 * Transcribes the episode and stores the transcript, summary and tags. A
 * busy renderer throws so the step retries; everything else is a logged
 * miss.
 */
export const transcribePodcastEpisode = async (
  job: CardJob,
  telemetry: WorkflowTelemetry
): Promise<PodcastOutcome> => {
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
  const aiGate = await job.deps.convex.query(internal.adminAccess.getAiGate, {
    userId: card.userId,
  });
  if (aiGate !== "allowed") {
    return miss("ai_off");
  }
  const page = await pageData(job, loaded);
  const enclosure = await resolveEnclosure(
    { ...page, sourceUrl: card.url },
    { pinnedFetch: job.deps.pinnedFetch, resolveDns: job.deps.resolveDns }
  );
  if (!enclosure) {
    return miss("no_enclosure");
  }
  const allowed = await job.deps.convex.mutation(
    internal.workflows.steps.podcast.mutations.takePodcastTranscriptSlot,
    { userId: card.userId }
  );
  if (!allowed) {
    return miss("rate_limited");
  }

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
    const download = await downloadEpisodeToR2(
      job.env.BUCKET,
      key,
      enclosure.url,
      {
        pinnedFetch: job.deps.pinnedFetch,
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
        let generated: { aiSummary?: string; aiTags?: string[] } = {};
        try {
          const content = buildLinkContentParts(card, undefined, transcript);
          const result = await generateLinkMetadata(
            job,
            telemetry,
            content.join("\n"),
            card.url
          );
          generated = { aiSummary: result.aiSummary, aiTags: result.aiTags };
        } catch (error) {
          // The transcript is kept; the summary from the page stays.
          console.warn("[cardProcessing/podcast] summary not regenerated", {
            cardId: job.cardId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        await job.deps.convex.mutation(
          internal.workflows.aiMetadata.mutations.updateCardAI,
          {
            aiTranscript: transcript,
            cardId: job.cardId,
            ...(generated.aiSummary ? { aiSummary: generated.aiSummary } : {}),
            ...(generated.aiTags?.length ? { aiTags: generated.aiTags } : {}),
          },
          guardOf(job)
        );
        return { transcribed: true } as const;
      }
    );
  } finally {
    // The audio is never kept: deleted first, then forgotten on the card.
    try {
      await job.env.BUCKET.delete(key);
    } catch (error) {
      console.warn("[cardProcessing/podcast] episode audio not deleted", {
        cardId: job.cardId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    // Not guarded: forgetting a deleted object is right whichever run owns
    // the card now, and an edit mid-transcription must not leave it listed.
    await job.deps.convex
      .mutation(internal.workflows.steps.podcast.mutations.trackPodcastAudio, {
        cardId: job.cardId,
        key,
        stored: false,
      })
      .catch(() => undefined);
  }
};
