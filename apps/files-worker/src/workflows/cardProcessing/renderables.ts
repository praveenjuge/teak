import { internal } from "@teak/convex/_generated/api";
import {
  stageCompleted,
  stageFailed,
} from "@teak/convex/card/processingStatus";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import type {
  FilesAnimationPaletteResult,
  FilesOp,
  FilesPdfThumbnailResult,
  FilesVideoFrameResult,
} from "@teak/files-protocol";
import {
  type CardJob,
  ensureObjectOwnership,
  guardOf,
  type LoadedCard,
  loadCard,
  markInProgress,
  objectKey,
} from "./context";
import { buildFilePreviewFactsForKey, recordMediaFacts } from "./files";
import { hasKnownTinyImageDimensions } from "./metadata";

// Renderables: what a card shows besides its file. Image sizes, EXIF and
// colors; video thumbnails and scrub sprites; PDF page thumbnails; archive
// and token previews.

interface ImageAnalysis {
  exif?: Record<string, number | string>;
  height: number;
  palette: string[];
  width: number;
}

type RenderingOutcome<T> =
  | { data: T; kind: "ok" }
  | { kind: "declined"; reason: string };

/**
 * A rendering op. `declined` means the source cannot be rendered (missing,
 * too large, undecodable), so retrying will not help; a busy or missing
 * renderer throws, so the step retries.
 */
const runRendering = async <T>(
  job: CardJob,
  op: Extract<
    FilesOp,
    | "capture-screenshot"
    | "extract-animation-palette"
    | "extract-video-frame"
    | "render-pdf-thumbnail"
  >,
  params: Record<string, unknown>
): Promise<RenderingOutcome<T>> => {
  const outcome = await job.deps.filesOp<T>({ op, params });
  return outcome.kind === "ok"
    ? outcome
    : {
        kind: "declined",
        reason: `${outcome.code.toLowerCase()}:${outcome.message}`,
      };
};

interface PartResult {
  error?: string;
  generated: boolean;
  retryable?: boolean;
  success: boolean;
}

const updateColors = (job: CardJob, palette: string[]) =>
  job.deps.convex.mutation(
    internal.workflows.aiMetadata.mutations.updateCardColors,
    { cardId: job.cardId, colors: palette.map((hex) => ({ hex })) },
    guardOf(job)
  );

const rethrowStale = (error: unknown) => {
  if (error instanceof Error && error.name === "NonRetryableError") {
    throw error;
  }
};

const analyzeImage = async (
  job: CardJob,
  { card }: LoadedCard
): Promise<PartResult> => {
  if (!card.fileKey || card.type !== "image") {
    return { generated: false, success: true };
  }
  try {
    const outcome = await job.deps.filesOp<ImageAnalysis>({
      op: "analyze-image",
      params: { sourceKey: card.fileKey },
    });
    if (outcome.kind !== "ok") {
      return {
        error: "files_worker_image_analysis_unavailable",
        generated: false,
        success: false,
      };
    }
    await job.deps.convex.mutation(
      internal.workflows.steps.renderables.mutations.updateCardFileMetadata,
      {
        cardId: job.cardId,
        height: outcome.data.height,
        width: outcome.data.width,
        ...(outcome.data.exif ? { exif: outcome.data.exif } : {}),
      },
      guardOf(job)
    );
    if (
      outcome.data.palette.length > 0 &&
      !hasKnownTinyImageDimensions(outcome.data)
    ) {
      await updateColors(job, outcome.data.palette);
    }
    return { generated: false, success: true };
  } catch (error) {
    rethrowStale(error);
    return {
      error: "files_worker_image_analysis_failed",
      generated: false,
      success: false,
    };
  }
};

const roundedSeconds = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value * 1000) / 1000
    : undefined;

const generateVideoThumbnail = async (
  job: CardJob,
  loaded: LoadedCard
): Promise<PartResult> => {
  const { card } = loaded;
  if (card.type !== "video" || !card.fileKey) {
    return { generated: false, success: true };
  }
  if (card.thumbnailKey) {
    return { generated: false, success: true };
  }
  const thumbnailKey = objectKey(loaded, {
    cardId: job.cardId,
    role: "thumbnail",
  });
  const scrubKey =
    card.scrubKey ?? objectKey(loaded, { cardId: job.cardId, role: "scrub" });
  await ensureObjectOwnership(job, card.userId, thumbnailKey);
  await ensureObjectOwnership(job, card.userId, scrubKey);
  let outcome: RenderingOutcome<FilesVideoFrameResult>;
  try {
    outcome = await runRendering<FilesVideoFrameResult>(
      job,
      "extract-video-frame",
      {
        destinationKey: thumbnailKey,
        scrubDestinationKey: scrubKey,
        sourceKey: card.fileKey,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[renderables/video] Frame extraction failed", {
      cardId: job.cardId,
      error: message,
    });
    return {
      error: message,
      generated: false,
      retryable: true,
      success: false,
    };
  }
  if (outcome.kind === "declined") {
    console.log("[renderables/video] Renderer declined", {
      cardId: job.cardId,
      reason: outcome.reason,
    });
    return {
      error: `video_thumbnail_declined:${outcome.reason}`,
      generated: false,
      retryable: false,
      success: false,
    };
  }
  const frame = outcome.data;
  const duration = roundedSeconds(
    frame.durationSeconds ?? frame.facts?.durationSeconds
  );
  await job.deps.convex.mutation(
    internal.workflows.steps.renderables.mutations.updateCardThumbnail,
    {
      cardId: job.cardId,
      thumbnailKey,
      ...(frame.originalWidth !== null && {
        originalWidth: frame.originalWidth,
      }),
      ...(frame.originalHeight !== null && {
        originalHeight: frame.originalHeight,
      }),
      ...(frame.scrub && { scrub: frame.scrub, scrubKey }),
      ...(duration !== undefined && { duration }),
    },
    guardOf(job)
  );
  if (frame.palette?.length) {
    await updateColors(job, frame.palette);
  }
  return { generated: true, success: true };
};

const extractAnimationPalette = async (
  job: CardJob,
  { card }: LoadedCard
): Promise<PartResult> => {
  if (
    card.type !== "video" ||
    !card.fileKey ||
    (card.colors?.length ?? 0) > 0 ||
    hasKnownTinyImageDimensions(card.fileMetadata)
  ) {
    return { generated: false, success: true };
  }
  let outcome: RenderingOutcome<FilesAnimationPaletteResult>;
  try {
    outcome = await runRendering<FilesAnimationPaletteResult>(
      job,
      "extract-animation-palette",
      { sourceKey: card.fileKey }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[renderables/animation] Palette failed", {
      cardId: job.cardId,
      error: message,
    });
    return {
      error: message,
      generated: false,
      retryable: true,
      success: false,
    };
  }
  if (outcome.kind === "declined") {
    console.log("[renderables/animation] Renderer declined", {
      cardId: job.cardId,
      reason: outcome.reason,
    });
    return { generated: false, success: true };
  }
  if (outcome.data.palette.length > 0) {
    await updateColors(job, outcome.data.palette);
  }
  return { generated: false, success: true };
};

const generateFilePreview = async (
  job: CardJob,
  { card }: LoadedCard
): Promise<void> => {
  const fileName = card.fileMetadata?.fileName;
  if (!(card.fileKey && fileName)) {
    return;
  }
  const format = inferFileFormat({
    fileName,
    mimeType: card.fileMetadata?.mimeType,
  });
  if (!format) {
    return;
  }
  try {
    const preview = await buildFilePreviewFactsForKey(
      job,
      card.fileKey,
      format
    );
    if (preview) {
      await job.deps.convex.mutation(
        internal.workflows.steps.renderables.mutations.updateCardFilePreview,
        { cardId: job.cardId, preview },
        guardOf(job)
      );
    }
  } catch (error) {
    rethrowStale(error);
  }
};

const generatePdfThumbnail = async (
  job: CardJob,
  loaded: LoadedCard
): Promise<PartResult> => {
  const { card } = loaded;
  if (
    card.type !== "document" ||
    !card.fileKey ||
    card.fileMetadata?.mimeType !== "application/pdf"
  ) {
    return { generated: false, success: true };
  }
  if (card.thumbnailKey) {
    return { generated: false, success: true };
  }
  const thumbnailKey = objectKey(loaded, {
    cardId: job.cardId,
    role: "thumbnail",
  });
  await ensureObjectOwnership(job, card.userId, thumbnailKey);
  let outcome: RenderingOutcome<FilesPdfThumbnailResult>;
  try {
    outcome = await runRendering<FilesPdfThumbnailResult>(
      job,
      "render-pdf-thumbnail",
      { destinationKey: thumbnailKey, sourceKey: card.fileKey }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[renderables/pdf] Page render failed", {
      cardId: job.cardId,
      error: message,
    });
    return {
      error: message,
      generated: false,
      retryable: true,
      success: false,
    };
  }
  if (outcome.kind === "declined") {
    console.log("[renderables/pdf] Renderer declined", {
      cardId: job.cardId,
      reason: outcome.reason,
    });
    return {
      error: `pdf_thumbnail_declined:${outcome.reason}`,
      generated: false,
      retryable: false,
      success: false,
    };
  }
  await job.deps.convex.mutation(
    internal.workflows.steps.renderables.mutations.updateCardThumbnail,
    {
      cardId: job.cardId,
      originalHeight: outcome.data.height,
      originalWidth: outcome.data.width,
      thumbnailKey,
    },
    guardOf(job)
  );
  return { generated: true, success: true };
};

export interface RenderablesResult {
  mode: "completed" | "skipped";
  success: boolean;
  thumbnailGenerated: boolean;
}

/**
 * Generates a card's renderables and records the stage. A busy or missing
 * renderer throws so the step retries; a source it cannot render fails the
 * stage without a retry.
 */
export const generateRenderables = async (
  job: CardJob,
  cardType: string
): Promise<RenderablesResult> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return { mode: "skipped", success: true, thumbnailGenerated: false };
  }
  await markInProgress(job, ["renderables"]);
  const { card } = loaded;

  let thumbnailGenerated = false;
  let succeeded = true;
  let failureReason: string | undefined;
  const handle = (result: PartResult) => {
    if (!result.success) {
      succeeded = false;
      failureReason ??= result.error || "thumbnail_generation_failed";
      return;
    }
    if (result.generated) {
      thumbnailGenerated = true;
    }
  };
  const throwIfRetryable = (result: PartResult) => {
    if (!result.success && result.retryable) {
      throw new Error(
        `renderables_retryable:${result.error ?? "thumbnail_generation_failed"}`
      );
    }
  };

  const fileName = card.fileMetadata?.fileName;
  const format = fileName
    ? (inferFileFormat({ fileName, mimeType: card.fileMetadata?.mimeType }) ??
      inferFileFormat({ fileName }))
    : null;
  const isGif = format?.id === "gif";

  if (cardType === "image" && card.fileKey) {
    handle(await analyzeImage(job, loaded));
  }
  if (cardType === "video" && card.fileKey && !isGif) {
    const result = await generateVideoThumbnail(job, loaded);
    throwIfRetryable(result);
    if (!result.generated) {
      await recordMediaFacts(job, card, "video");
    }
    handle(result);
  }
  if (cardType === "video" && card.fileKey && isGif) {
    const result = await extractAnimationPalette(job, loaded);
    throwIfRetryable(result);
    handle(result);
  }
  if (cardType === "document" && card.fileKey) {
    await generateFilePreview(job, loaded);
  }
  if (
    cardType === "document" &&
    card.fileKey &&
    card.fileMetadata?.mimeType === "application/pdf"
  ) {
    const result = await generatePdfThumbnail(job, loaded);
    throwIfRetryable(result);
    handle(result);
  }

  const now = Date.now();
  const saved = await job.deps.convex.mutation(
    internal.ai.mutations.updateCardProcessing,
    {
      cardId: job.cardId,
      processingStatus: {
        renderables: succeeded
          ? stageCompleted(now, 0.95)
          : stageFailed(
              now,
              failureReason ?? "renderables_failed",
              card.processingStatus?.renderables
            ),
      },
    },
    guardOf(job)
  );
  return {
    mode: saved === false ? "skipped" : "completed",
    success: saved === false ? true : succeeded,
    thumbnailGenerated,
  };
};

/** An image card's palette, when renderables left it without colors. */
export const extractPaletteFromImage = async (job: CardJob): Promise<void> => {
  const loaded = await loadCard(job);
  const card = loaded?.card;
  if (card?.type !== "image" || !card.fileKey) {
    return;
  }
  if (
    (Array.isArray(card.colors) && card.colors.length > 0) ||
    hasKnownTinyImageDimensions(card.fileMetadata)
  ) {
    return;
  }
  try {
    const outcome = await job.deps.filesOp<ImageAnalysis>({
      op: "analyze-image",
      params: { sourceKey: card.fileKey },
    });
    if (outcome.kind !== "ok") {
      return;
    }
    const { exif, height, palette, width } = outcome.data;
    if (
      !Array.isArray(palette) ||
      palette.length === 0 ||
      hasKnownTinyImageDimensions({ height, width })
    ) {
      return;
    }
    await job.deps.convex.mutation(
      internal.workflows.steps.renderables.mutations.updateCardFileMetadata,
      { cardId: job.cardId, height, width, ...(exif ? { exif } : {}) },
      guardOf(job)
    );
    await updateColors(job, palette);
  } catch (error) {
    rethrowStale(error);
  }
};
