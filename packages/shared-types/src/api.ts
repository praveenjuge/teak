// API response and request types
import type { CardData, CardType, MetaInfo } from './cards';

// Card interface for frontend applications
export interface Card {
  id: number;
  type: CardType;
  data: CardData;
  metaInfo: MetaInfo;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  userId: string;
}

// Cards response for paginated results
export interface CardsResponse {
  cards: Card[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// API error response
export interface ApiError {
  error: string;
}

// File upload request types moved to upload.ts

// Card stats response
export interface CardStatsResponse {
  total: number;
  by_type: Record<Card['type'], number>;
}

// Search response
export interface SearchResponse extends CardsResponse {
  query: string;
}

// API parameters for card operations
export interface GetCardsParams {
  limit?: number;
  offset?: number;
  q?: string;
  type?: Card['type'];
  sort?: 'created_at' | 'updated_at' | 'type';
  order?: 'asc' | 'desc';
}

export interface SearchCardsParams {
  limit?: number;
  offset?: number;
  type?: Card['type'];
}

export interface CreateCardParams {
  type: Card['type'];
  data: CardData;
  metaInfo?: MetaInfo;
}

export interface UpdateCardParams {
  data?: Partial<CardData>;
  metaInfo?: Partial<MetaInfo>;
}

// Backend service interfaces
export interface CreateCardRequest {
  type: CardType;
  data: CardData;
  metaInfo?: MetaInfo;
  file?: File;
}

export interface CreateCardResponse {
  id: number;
  type: CardType;
  data: CardData;
  metaInfo: MetaInfo;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}
