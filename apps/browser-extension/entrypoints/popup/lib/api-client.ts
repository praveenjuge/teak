import type { ApiClient as IApiClient } from '@teak/shared-queries';
import type {
  AdminStatsResponse,
  Card,
  CardStatsResponse,
  CardsResponse,
  CreateCardParams,
  Job,
  SearchResponse,
  TagsResponse,
  User,
} from '@teak/shared-types';

// For browser extension, we need to point to the backend server directly
const API_BASE_URL = 'http://localhost:3001';

class ApiClient implements IApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const config: RequestInit = {
      credentials: 'include', // Include cookies for session management
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    const response = await fetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }

    return data;
  }

  async createCard(cardData: CreateCardParams): Promise<Card> {
    return this.request<Card>('/api/cards', {
      method: 'POST',
      body: JSON.stringify(cardData),
    });
  }

  // Minimal implementations for methods we don't need in browser extension
  async getCards(): Promise<CardsResponse> {
    throw new Error('Not implemented in browser extension');
  }

  async getCard(): Promise<Card> {
    throw new Error('Not implemented in browser extension');
  }

  async getTags(): Promise<TagsResponse> {
    throw new Error('Not implemented in browser extension');
  }

  async updateCard(): Promise<Card> {
    throw new Error('Not implemented in browser extension');
  }

  async deleteCard(): Promise<void> {
    throw new Error('Not implemented in browser extension');
  }

  async searchCards(): Promise<SearchResponse> {
    throw new Error('Not implemented in browser extension');
  }

  async getCardStats(): Promise<CardStatsResponse> {
    throw new Error('Not implemented in browser extension');
  }

  async createCardWithFile(): Promise<Card> {
    throw new Error('Not implemented in browser extension');
  }

  async getJobs(): Promise<Job[]> {
    throw new Error('Not implemented in browser extension');
  }

  async createRefetchOgImagesJob(): Promise<Job> {
    throw new Error('Not implemented in browser extension');
  }

  async createRefetchScreenshotsJob(): Promise<Job> {
    throw new Error('Not implemented in browser extension');
  }

  async createRefreshAiDataJob(): Promise<Job> {
    throw new Error('Not implemented in browser extension');
  }

  async getAdminStats(): Promise<AdminStatsResponse> {
    throw new Error('Not implemented in browser extension');
  }

  async getUsers(): Promise<User[]> {
    throw new Error('Not implemented in browser extension');
  }

  async getAiSettings(): Promise<Record<string, any>> {
    throw new Error('Not implemented in browser extension');
  }

  async updateAiSettings(): Promise<{ success: boolean }> {
    throw new Error('Not implemented in browser extension');
  }
}

export const apiClient = new ApiClient();
