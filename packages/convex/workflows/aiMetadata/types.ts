import type { CardType } from "../../schema";
import type { Id } from "../../shared/types";

export interface AiMetadataWorkflowArgs {
  cardId: Id<"cards">;
  cardType?: CardType;
}

export interface AiMetadataResult {
  aiSummary: string;
  aiTags: string[];
  aiTranscript?: string;
  confidence: number;
}
