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
