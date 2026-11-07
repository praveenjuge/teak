export type GetCurrentValue = (
  field: "content" | "url" | "notes" | "aiSummary" | "metadataTitle"
) => string | undefined;
