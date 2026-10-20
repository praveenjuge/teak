import { internal } from "@teak/convex/_generated/api";
import {
  stageCompleted,
  stagePending,
} from "@teak/convex/card/processingStatus";
import { cardLinkTokensToText } from "@teak/convex/shared/cardLinks";
import {
  extractVisualStylesFromTags,
  isVisualStyleCardType,
} from "@teak/convex/shared/constants";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import {
  fetchVideoCaptions,
  hasCaptionSource,
  type VideoCaptions,
} from "@teak/convex/workflows/steps/captions/index";
import {
  buildLinkMetadataPrompt,
  isScannedPdf,
  MAX_AI_METADATA_INPUT_CHARS,
} from "@teak/files-protocol";
import { runWithAiUsage } from "../../ai/aiUsage";
import type { WorkflowTelemetry } from "../telemetry";
import {
  generateImageMetadataForStoredKey,
  generateLinkMetadata,
  generateTextMetadata,
  isAiMetadataDeferredError,
  isAiProviderCapacityError,
} from "./aiMetadata";
import {
  type CardDoc,
  type CardJob,
  guardOf,
  type LoadedCard,
  loadCard,
} from "./context";
import {
  extractFileTextForKey,
  processAudioCard,
  readScannedPdfText,
  storeDocumentText,
} from "./files";
import { resolveImageAnalysisKey } from "./imageAnalysisKey";
import { hydrateArchivedMetadata } from "./rawMetadata";

interface LinkPreviewFields {
  author?: string;
  description?: string;
  publishedAt?: string;
  publisher?: string;
  status?: string;
  title?: string;
}

export const buildLinkContentParts = (
  card: {
    content?: string;
    metadata?: { linkPreview?: LinkPreviewFields };
    url?: string;
  },
  siteSummary?: string,
  transcript?: string
): string[] => {
  const preview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const contentParts: string[] = [];
  if (preview?.title) {
    contentParts.push(`Title: ${preview.title}`);
  }
  if (preview?.description) {
    contentParts.push(`Description: ${preview.description}`);
  }
  if (preview?.author) {
    contentParts.push(`Author: ${preview.author}`);
  }
  if (preview?.publisher) {
    contentParts.push(`Publisher: ${preview.publisher}`);
  }
  if (preview?.publishedAt) {
    contentParts.push(`Published: ${preview.publishedAt}`);
  }
  if (contentParts.length === 0) {
    const urlFallback = card.url || card.content;
    if (urlFallback) {
      contentParts.push(`URL: ${urlFallback}`);
    }
  }
  const promptOverhead = buildLinkMetadataPrompt(
    "",
    card.url || card.content
  ).length;
  for (const [label, text] of [
    [SUMMARY_LABEL, siteSummary],
    [TRANSCRIPT_LABEL, transcript],
  ] as const) {
    const trimmed = text?.trim();
    if (!trimmed) {
      continue;
    }
    const used = contentParts.reduce(
      (total, part) => total + part.length + 1,
      0
    );
    const room =
      MAX_AI_METADATA_INPUT_CHARS - promptOverhead - used - label.length;
    if (room > 0) {
      contentParts.push(`${label}${trimmed.slice(0, room)}`);
    }
  }
  return contentParts;
};

const SUMMARY_LABEL = "Summary: ";
const TRANSCRIPT_LABEL = "Transcript: ";

const linkSiteSummary = async (
  job: CardJob,
  loaded: LoadedCard
): Promise<string | undefined> => {
  const { card } = loaded;
  const linkCategory = card.metadata?.linkCategory;
  if (!linkCategory) {
    return;
  }
  try {
    const hydrated = await hydrateArchivedMetadata(job.env, loaded.keyPrefix, {
      _id: card._id,
      metadata: { linkCategory },
      userId: card.userId,
    });
    const raw = hydrated.metadata.linkCategory?.raw as
      | { remote?: { sourceUrl?: unknown; summary?: unknown } }
      | undefined;
    // Details a site gave for the link's earlier URL describe another page.
    if (raw?.remote?.sourceUrl !== (card.url || linkCategory.sourceUrl)) {
      return;
    }
    const summary = raw?.remote?.summary;
    return typeof summary === "string" ? summary : undefined;
  } catch (error) {
    console.warn("[cardProcessing/metadata] site summary unavailable", {
      cardId: job.cardId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export interface MetadataResult {
  aiTagsCount: number;
  cardType?: string;
  confidence: number;
  hasSummary: boolean;
  hasTranscript: boolean;
  mode: "completed" | "deferred" | "skipped";
}

const nothing = (mode: MetadataResult["mode"]): MetadataResult => ({
  aiTagsCount: 0,
  confidence: 0,
  hasSummary: false,
  hasTranscript: false,
  mode,
});

export interface MetadataOptions {
  capacity: "defer" | "retry";
  lastAttempt?: boolean;
  restorePendingOnDefer: boolean;
}

interface Generated {
  aiOcrText?: string;
  aiSummary: string;
  aiTags: string[];
  aiTranscript?: string;
  confidence: number;
  ocrChecked?: boolean;
  visualStyles?: string[];
}

/**
 * A video link's captions as its transcript (Vimeo), or undefined for any
 * other link and whenever the site has none or can't be reached.
 */
const videoCaptions = async (
  job: CardJob,
  card: CardDoc
): Promise<VideoCaptions | undefined> => {
  if (!hasCaptionSource(card.url)) {
    return;
  }
  return (
    (await fetchVideoCaptions(card.url as string, {
      pinnedFetch: job.deps.pinnedFetch,
      resolveDns: job.deps.resolveDns,
    })) ?? undefined
  );
};

const transcribeVideo = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  loaded: LoadedCard
): Promise<string | undefined> => {
  if (!loaded.card.fileKey) {
    return;
  }
  try {
    const { transcript } = await processAudioCard(job, telemetry, loaded, {
      recordFacts: false,
    });
    return transcript ?? undefined;
  } catch (error) {
    console.warn("[cardProcessing/metadata] video transcript unavailable", {
      cardId: job.cardId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const keepDocumentText = async (
  job: CardJob,
  loaded: LoadedCard,
  extracted: { pageCount?: number; text: string }
): Promise<void> => {
  try {
    await storeDocumentText(job, loaded, extracted);
  } catch (error) {
    if (error instanceof Error && error.name === "NonRetryableError") {
      throw error;
    }
    console.warn("[cardProcessing/metadata] document text not stored", {
      cardId: job.cardId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const paletteText = (card: CardDoc): string => {
  let content = card.content || "";
  if (card.colors && card.colors.length > 0) {
    const colorInfo = card.colors
      .map((color) => `${color.hex}${color.name ? ` (${color.name})` : ""}`)
      .join(", ");
    content = `Colors: ${colorInfo}\n${content}`;
  }
  return content;
};

const readScan = async (
  job: CardJob,
  sourceKey: string,
  options: MetadataOptions
): Promise<string | null> => {
  try {
    return await readScannedPdfText(job, sourceKey);
  } catch (error) {
    if (!options.lastAttempt || isAiProviderCapacityError(error)) {
      throw error;
    }
    console.warn("[cardProcessing/metadata] scan not read", {
      cardId: job.cardId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const generateForType = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  loaded: LoadedCard,
  cardType: string,
  options: MetadataOptions
): Promise<Generated> => {
  const { card } = loaded;
  const empty: Generated = { aiSummary: "", aiTags: [], confidence: 0.9 };
  switch (cardType) {
    case "text":
    case "quote": {
      if (cardType === "quote" && !card.content?.trim()) {
        return empty;
      }
      // `[[Title|teak:<id>]]` links reach the model as their titles.
      const result = await generateTextMetadata(
        job,
        telemetry,
        cardLinkTokensToText(card.content ?? "")
      );
      return { ...result, confidence: 0.95 };
    }
    case "image": {
      const imageKey = resolveImageAnalysisKey(card);
      if (!imageKey) {
        return empty;
      }
      const result = await generateImageMetadataForStoredKey(
        job,
        imageKey,
        undefined,
        { telemetry }
      );
      return {
        ...result,
        confidence: 0.9,
        ocrChecked: result.ocrChecked,
        visualStyles:
          result.visualStyles ?? extractVisualStylesFromTags(result.aiTags),
      };
    }
    case "video": {
      let generated = empty;
      if (card.thumbnailKey) {
        const title =
          card.fileMetadata?.fileName ||
          (typeof card.content === "string" ? card.content : undefined);
        const result = await generateImageMetadataForStoredKey(
          job,
          card.thumbnailKey,
          title,
          { telemetry }
        );
        generated = {
          ...result,
          confidence: 0.88,
          ocrChecked: result.ocrChecked,
          visualStyles:
            result.visualStyles ?? extractVisualStylesFromTags(result.aiTags),
        };
      }
      const aiTranscript = await transcribeVideo(job, telemetry, loaded);
      if (aiTranscript && !card.thumbnailKey) {
        const result = await generateTextMetadata(job, telemetry, aiTranscript);
        generated = { ...result, confidence: 0.85 };
      }
      return { ...generated, aiTranscript };
    }
    case "audio": {
      if (!card.fileKey) {
        return empty;
      }
      const { transcript } = await processAudioCard(job, telemetry, loaded);
      if (!transcript) {
        return empty;
      }
      const result = await generateTextMetadata(job, telemetry, transcript);
      return { ...result, aiTranscript: transcript, confidence: 0.85 };
    }
    case "link": {
      const captions = await videoCaptions(job, card);
      const content = buildLinkContentParts(
        card,
        await linkSiteSummary(job, loaded),
        captions?.text
      ).join("\n");
      if (!content.trim()) {
        return captions ? { ...empty, aiTranscript: captions.text } : empty;
      }
      const result = await generateLinkMetadata(
        job,
        telemetry,
        content,
        card.url || card.content
      );
      return {
        ...result,
        confidence: 0.9,
        ...(captions ? { aiTranscript: captions.text } : {}),
      };
    }
    case "document": {
      const contentParts: string[] = [];
      let aiOcrText = "";
      let ocrChecked = false;
      const fileName = card.fileMetadata?.fileName;
      if (fileName) {
        contentParts.push(fileName);
      }
      if (card.fileKey && fileName) {
        const format = inferFileFormat({
          fileName,
          mimeType: card.fileMetadata?.mimeType,
        });
        if (format) {
          const extracted = await extractFileTextForKey(
            job,
            card.fileKey,
            format,
            card
          );
          if (extracted.text) {
            contentParts.push(extracted.text);
            await keepDocumentText(job, loaded, extracted);
          }
          if (format.kind === "pdf") {
            const scanText = isScannedPdf(extracted)
              ? await readScan(job, card.fileKey, options)
              : "";
            aiOcrText = scanText ?? "";
            if (aiOcrText) {
              contentParts.push(aiOcrText);
            }
            ocrChecked = scanText !== null;
          }
        }
      }
      if (card.content?.trim()) {
        contentParts.push(card.content);
      }
      const content = contentParts.join("\n");
      if (!content.trim()) {
        return empty;
      }
      const result = await generateTextMetadata(job, telemetry, content);
      return {
        ...result,
        confidence: 0.85,
        ocrChecked,
        ...(aiOcrText ? { aiOcrText } : {}),
      };
    }
    case "palette": {
      const content = paletteText(card);
      if (!content.trim()) {
        return empty;
      }
      const result = await generateTextMetadata(job, telemetry, content);
      return { ...result, confidence: 0.9 };
    }
    default:
      return empty;
  }
};

const completeWithoutAi = async (
  job: CardJob,
  read: Pick<Generated, "aiOcrText" | "ocrChecked"> = {}
): Promise<MetadataResult> => {
  await job.deps.convex.mutation(
    internal.workflows.aiMetadata.mutations.updateCardAI,
    {
      aiTags: [],
      cardId: job.cardId,
      processingStatus: { metadata: stageCompleted(Date.now(), 0) },
      ...(read.aiOcrText ? { aiOcrText: read.aiOcrText } : {}),
      ...(read.ocrChecked ? { ocrCheckedAt: Date.now() } : {}),
    },
    guardOf(job)
  );
  return nothing("skipped");
};

const deferToBackfill = async (
  job: CardJob,
  options: MetadataOptions
): Promise<MetadataResult> => {
  if (options.restorePendingOnDefer) {
    await job.deps.convex.mutation(
      internal.ai.mutations.updateCardProcessing,
      {
        cardId: job.cardId,
        onlyIfInProgress: true,
        processingStatus: { metadata: stagePending() },
      },
      guardOf(job)
    );
  }
  return nothing("deferred");
};

export const generateCardMetadata = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  cardType: string | undefined,
  options: MetadataOptions
): Promise<MetadataResult> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return nothing("skipped");
  }
  const { card } = loaded;
  return await runWithAiUsage(
    {
      cardId: job.cardId,
      convexSiteUrl: job.convexSiteUrl,
      userId: card.userId,
    },
    async () => {
      const aiGate = await job.deps.aiGate(card.userId);
      if (aiGate === "user_disabled") {
        return await completeWithoutAi(job);
      }
      if (aiGate === "paused") {
        console.warn(
          "[cardProcessing/metadata] AI paused from the console; deferring",
          { cardId: job.cardId }
        );
        return await deferToBackfill(job, options);
      }
      const type = cardType ?? card.type ?? "text";
      let generated: Generated;
      try {
        generated = await generateForType(
          job,
          telemetry,
          loaded,
          type,
          options
        );
      } catch (error) {
        if (
          !isAiMetadataDeferredError(error) ||
          (options.capacity === "retry" && isAiProviderCapacityError(error))
        ) {
          throw error;
        }
        console.warn(
          "[cardProcessing/metadata] AI metadata unavailable; deferring",
          { cardId: job.cardId, cardType: type }
        );
        return await deferToBackfill(job, options);
      }
      const {
        aiOcrText,
        aiSummary,
        aiTags,
        aiTranscript,
        confidence,
        ocrChecked,
        visualStyles,
      } = generated;
      if (
        aiTags.length === 0 &&
        !aiSummary &&
        !aiTranscript &&
        !visualStyles?.length
      ) {
        return await completeWithoutAi(job, { aiOcrText, ocrChecked });
      }
      const saved = await job.deps.convex.mutation(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        {
          cardId: job.cardId,
          processingStatus: {
            metadata: stageCompleted(Date.now(), confidence),
          },
          ...(aiTags.length > 0 ? { aiTags } : {}),
          ...(aiSummary ? { aiSummary } : {}),
          ...(aiTranscript ? { aiTranscript } : {}),
          ...(aiOcrText ? { aiOcrText } : {}),
          ...(ocrChecked ? { ocrCheckedAt: Date.now() } : {}),
          ...(isVisualStyleCardType(type) && visualStyles?.length
            ? { visualStyles }
            : {}),
        },
        guardOf(job)
      );
      if (saved === false) {
        return nothing("skipped");
      }
      return {
        aiTagsCount: aiTags.length,
        cardType: type,
        confidence,
        hasSummary: Boolean(aiSummary),
        hasTranscript: Boolean(aiTranscript),
        mode: "completed",
      };
    }
  );
};
