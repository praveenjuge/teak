// Card processing interfaces
export interface ProcessedCardData {
  data: Record<string, unknown>;
  metaInfo: Record<string, unknown>;
}

export interface ProcessingContext {
  userId: string;
  file?: File;
  inputData: Record<string, unknown>;
}
