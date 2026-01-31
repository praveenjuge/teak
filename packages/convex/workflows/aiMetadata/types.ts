import type { CardType } from "../../schema";
import type { Id } from "../../shared/types";

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
