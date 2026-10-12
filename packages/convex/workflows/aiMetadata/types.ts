import type { CardType } from "../../schema";
import type { Id } from "../../shared/types";

export interface AiMetadataWorkflowArgs {
  cardId: Id<"cards">;
  cardType?: CardType;
}

export interface AiMetadataResult {
  aiTagsCount: number;
  confidence: number;
  hasSummary: boolean;
  hasTranscript: boolean;
  mode: "completed" | "skipped";
}
