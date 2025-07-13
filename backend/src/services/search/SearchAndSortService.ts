import type { CardType } from '../../schemas/cards';

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
  cards: any[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  query?: string;
}

export abstract class SearchAndSortService {
  abstract searchCards(options: SearchOptions): Promise<SearchResult>;
}
