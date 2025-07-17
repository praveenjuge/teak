// Card processing interfaces
export interface ProcessedCardData {
  data: Record<string, any>;
  metaInfo: Record<string, any>;
}

export interface ProcessingContext {
  userId: string;
  file?: File;
  inputData: Record<string, any>;
}
