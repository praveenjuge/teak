// API response and request types
import type { CardData, CardType, MetaInfo } from './cards';

// Card interface for frontend applications
export interface Card {
  id: number;
  type: CardType;
  data: CardData;
  metaInfo: MetaInfo;
  // AI enrichment fields
  aiSummary?: string | null;
  aiTags?: string[] | null;
  aiTranscript?: string | null;
  aiProcessedAt?: string | null;
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

// Admin stats response (system-wide statistics)
export interface AdminStatsResponse {
  overview: {
    totalUsers: number;
    totalCards: number;
    totalJobs: number;
    storageUsed: string;
  };
  cards: {
    total: number;
    byType: Record<Card['type'], number>;
    byUser: Array<{
      userId: string;
      userName: string;
      userEmail: string;
      cardCount: number;
    }>;
    recentActivity: Array<{
      date: string;
      count: number;
    }>;
  };
  users: {
    total: number;
    recentRegistrations: Array<{
      date: string;
      count: number;
    }>;
    activeUsers: Array<{
      userId: string;
      userName: string;
      userEmail: string;
      lastActivity: string;
      cardCount: number;
    }>;
  };
  jobs: {
    total: number;
    byStatus: Record<'pending' | 'processing' | 'completed' | 'failed', number>;
    byType: Record<
      'refetch-og-images' | 'refetch-screenshots' | 'process-card',
      number
    >;
    successRate: number;
  };
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
  // AI enrichment fields
  aiSummary?: string | null;
  aiTags?: string[] | null;
  aiTranscript?: string | null;
  aiProcessedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}
