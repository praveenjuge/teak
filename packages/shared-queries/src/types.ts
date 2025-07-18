import type {
  Card,
  CardStatsResponse,
  CardsResponse,
  SearchResponse,
} from '@teak/shared-types';

export interface ApiClient {
  getCards(params?: {
    limit?: number;
    offset?: number;
    q?: string;
    type?: Card['type'];
    sort?: 'created_at' | 'updated_at' | 'type';
    order?: 'asc' | 'desc';
  }): Promise<CardsResponse>;

  getCard(id: number): Promise<Card>;

  createCard(cardData: {
    type: Card['type'];
    data: Record<string, any>;
    metaInfo?: Record<string, any>;
  }): Promise<Card>;

  updateCard(
    id: number,
    data: {
      data?: Record<string, any>;
      metaInfo?: Record<string, any>;
    }
  ): Promise<Card>;

  deleteCard(id: number): Promise<void>;

  searchCards(
    query: string,
    params?: {
      limit?: number;
      offset?: number;
      type?: Card['type'];
    }
  ): Promise<SearchResponse>;

  getCardStats(): Promise<CardStatsResponse>;

  createCardWithFile(
    file: File,
    cardData?: {
      type?: Card['type'];
      data?: Record<string, any>;
      metaInfo?: Record<string, any>;
    },
    onUploadProgress?: (progress: number) => void
  ): Promise<Card>;
}

export interface UseCardsParams {
  limit?: number;
  offset?: number;
  q?: string;
  type?: Card['type'];
  sort?: 'created_at' | 'updated_at' | 'type';
  order?: 'asc' | 'desc';
}

export interface UseSearchCardsParams {
  limit?: number;
  offset?: number;
  type?: Card['type'];
}

export interface CreateCardData {
  type: Card['type'];
  data: Record<string, any>;
  metaInfo?: Record<string, any>;
}

export interface UpdateCardData {
  data?: Record<string, any>;
  metaInfo?: Record<string, any>;
}

export interface CreateCardWithFileData {
  file: File;
  cardData?: {
    type?: Card['type'];
    data?: Record<string, any>;
    metaInfo?: Record<string, any>;
  };
}
