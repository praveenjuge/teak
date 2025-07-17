import type { SearchOptions, SearchResult } from '@teak/shared-types';

export abstract class SearchAndSortService {
  abstract searchCards(options: SearchOptions): Promise<SearchResult>;
}
