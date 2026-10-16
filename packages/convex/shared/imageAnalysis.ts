/**
 * Which stored image the AI reads for a card: its thumbnail, else the file
 * itself when it is big enough. Tiny images (icons, spacer pixels) are
 * skipped. The Files Worker's metadata step and Convex's visual styles
 * backfill both use it.
 */

export const MIN_IMAGE_ANALYSIS_DIMENSION = 12;

interface ImageDimensions {
  height?: number;
  width?: number;
}

const hasStoredDimensions = (
  dimensions?: ImageDimensions
): dimensions is Required<ImageDimensions> =>
  typeof dimensions?.width === "number" &&
  typeof dimensions.height === "number";

export const hasMinimumImageAnalysisDimensions = (
  dimensions?: ImageDimensions
) =>
  hasStoredDimensions(dimensions) &&
  dimensions.width >= MIN_IMAGE_ANALYSIS_DIMENSION &&
  dimensions.height >= MIN_IMAGE_ANALYSIS_DIMENSION;

export const hasKnownTinyImageDimensions = (dimensions?: ImageDimensions) =>
  hasStoredDimensions(dimensions) &&
  (dimensions.width < MIN_IMAGE_ANALYSIS_DIMENSION ||
    dimensions.height < MIN_IMAGE_ANALYSIS_DIMENSION);

export const resolveImageAnalysisKey = (card: {
  fileKey?: string;
  fileMetadata?: ImageDimensions;
  thumbnailKey?: string;
}): string | undefined => {
  if (hasKnownTinyImageDimensions(card.fileMetadata)) {
    return;
  }
  if (card.thumbnailKey) {
    return card.thumbnailKey;
  }
  if (card.fileKey && hasMinimumImageAnalysisDimensions(card.fileMetadata)) {
    return card.fileKey;
  }
};
