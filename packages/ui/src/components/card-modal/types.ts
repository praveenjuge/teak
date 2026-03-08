import type { Doc } from "@teak/convex/_generated/dataModel";

export type CardModalCard = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewMedia?: Array<{
    contentType?: string;
    height?: number;
    posterContentType?: string;
    posterHeight?: number;
    posterUrl?: string;
    posterWidth?: number;
    type: "image" | "video";
    url: string;
    width?: number;
  }>;
  linkPreviewImageUrl?: string;
};

export type GetCurrentValue = (
  field: "content" | "url" | "notes" | "aiSummary"
) => string | undefined;
