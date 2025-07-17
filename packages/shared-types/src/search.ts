import type { CardType, DbCardResponse } from './cards';

// Search service interfaces
export interface SearchOptions {
  query?: string;
  type?: CardType;
  limit?: number;
  offset?: number;
  sort?: 'created_at' | 'updated_at' | 'type';
  order?: 'asc' | 'desc';
  userId: string;
}

export interface SearchResult {
  cards: DbCardResponse[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  query?: string;
}
