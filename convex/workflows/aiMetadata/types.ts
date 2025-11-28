import type { Id } from "../../shared/types";
import type { CardType } from "../../schema";

export type AiMetadataWorkflowArgs = {
  cardId: Id<"cards">;
  cardType?: CardType;
};

export type AiMetadataResult = {
  aiTags: string[];
  aiSummary: string;
  aiTranscript?: string;
  confidence: number;
};
