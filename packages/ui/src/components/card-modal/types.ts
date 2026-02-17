import type { Doc } from "@teak/convex/_generated/dataModel";

export type CardModalCard = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

export type GetCurrentValue = (
  field: "content" | "url" | "notes" | "aiSummary"
) => string | undefined;
