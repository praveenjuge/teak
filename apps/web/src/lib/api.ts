const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface Card {
  id: number;
  type: 'audio' | 'text' | 'url' | 'image' | 'video';
  data: Record<string, any>;
  metaInfo: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  userId: string;
}

export interface CardsResponse {
  cards: Card[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ApiError {
  error: string;
}

class ApiClient {
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

  async getCards(params: {
    limit?: number;
    offset?: number;
    q?: string;
    type?: Card['type'];
    sort?: 'created_at' | 'updated_at' | 'type';
    order?: 'asc' | 'desc';
  } = {}): Promise<CardsResponse> {
    const queryParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        queryParams.append(key, value.toString());
      }
    });

    const queryString = queryParams.toString();
    const endpoint = `/api/cards${queryString ? `?${queryString}` : ''}`;

    return this.request<CardsResponse>(endpoint);
  }

  async getCard(id: number): Promise<Card> {
    return this.request<Card>(`/api/cards/${id}`);
  }

  async createCard(cardData: {
    type: Card['type'];
    data: Record<string, any>;
    metaInfo?: Record<string, any>;
  }): Promise<Card> {
    return this.request<Card>('/api/cards', {
      method: 'POST',
      body: JSON.stringify(cardData),
    });
  }

  async updateCard(id: number, cardData: {
    data?: Record<string, any>;
    metaInfo?: Record<string, any>;
  }): Promise<Card> {
    return this.request<Card>(`/api/cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(cardData),
    });
  }

  async deleteCard(id: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/api/cards/${id}`, {
      method: 'DELETE',
    });
  }

  async searchCards(query: string, params: {
    limit?: number;
    offset?: number;
    type?: Card['type'];
  } = {}): Promise<CardsResponse & { query: string }> {
    const queryParams = new URLSearchParams({
      q: query,
      ...Object.fromEntries(
        Object.entries(params).filter(([_, value]) => value !== undefined)
      ) as Record<string, string>
    });

    return this.request<CardsResponse & { query: string }>(`/api/cards/search?${queryParams}`);
  }

  async getCardStats(): Promise<{
    total: number;
    by_type: Record<Card['type'], number>;
  }> {
    return this.request<{
      total: number;
      by_type: Record<Card['type'], number>;
    }>('/api/cards/stats');
  }
}

export const apiClient = new ApiClient();
