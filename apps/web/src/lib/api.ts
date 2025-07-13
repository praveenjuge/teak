// For development, use relative URLs so Vite proxy can handle them
// For production, use empty string to use same origin
const API_BASE_URL = import.meta.env.PROD ? '' : '';

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

  async createCardWithFile(
    file: File,
    cardData?: {
      type?: Card['type'];
      data?: Record<string, any>;
      metaInfo?: Record<string, any>;
    },
    onProgress?: (progress: number) => void
  ): Promise<Card> {
    const url = `${API_BASE_URL}/api/cards`;

    const formData = new FormData();
    formData.append('file', file);

    // Auto-detect card type based on file MIME type
    const detectedType = this.detectCardTypeFromFile(file);
    const type = cardData?.type || detectedType;

    formData.append('type', type);

    if (cardData?.data) {
      formData.append('data', JSON.stringify(cardData.data));
    }

    if (cardData?.metaInfo) {
      formData.append('metaInfo', JSON.stringify(cardData.metaInfo));
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (error) {
            reject(new Error('Invalid response format'));
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.error || `HTTP error! status: ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error'));
      });

      xhr.open('POST', url);
      xhr.withCredentials = true; // Include cookies for session management
      xhr.send(formData);
    });
  }

  private detectCardTypeFromFile(file: File): Card['type'] {
    // Note: This is only a UI hint - server validates actual file type from content
    if (file.type.startsWith('image/')) {
      return 'image';
    } else if (file.type.startsWith('video/')) {
      return 'video';
    } else if (file.type.startsWith('audio/')) {
      return 'audio';
    } else {
      // Default to letting server determine actual type
      return 'image';
    }
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
