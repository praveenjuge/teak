import { getStoredApiUrl, authClient } from './auth-client';

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
    const apiBaseUrl = await getStoredApiUrl();
    const url = `${apiBaseUrl}${endpoint}`;

    console.log('[ApiClient] Making request:', {
      endpoint,
      url,
      method: options.method || 'GET',
      apiBaseUrl
    });

    // Get session info for logging
    let sessionResult: any = null;
    if (authClient) {
      sessionResult = await authClient.getSession();
      console.log('[ApiClient] Session result:', {
        hasData: !!sessionResult.data,
        hasError: !!sessionResult.error,
        errorMessage: sessionResult.error?.message,
        sessionId: sessionResult.data?.session?.id,
        userId: sessionResult.data?.user?.id,
      });
    } else {
      console.log('[ApiClient] Auth client not available');
    }

    try {
      // Use Better Auth's built-in fetch that automatically handles authentication
      console.log('[ApiClient] Using authClient.$fetch for authenticated request');

      if (!authClient) {
        throw new Error('Auth client not available');
      }

      const authFetchUrl = `${apiBaseUrl}${endpoint}`;
      console.log('[ApiClient] AuthClient fetch URL:', authFetchUrl);

      const response = await authClient.$fetch(authFetchUrl, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        },
        body: options.body,
      });

      console.log('[ApiClient] AuthClient response success:', response);

      // Check if response is wrapped in Better Auth format { data: ..., error: null }
      if (response && typeof response === 'object' && 'data' in response && 'error' in response) {
        console.log('[ApiClient] Unwrapping Better Auth response format');
        const wrappedResponse = response as any;
        if (wrappedResponse.error) {
          const errorMessage = typeof wrappedResponse.error === 'string' ? wrappedResponse.error : wrappedResponse.error.message || 'Unknown error';
          throw new Error(errorMessage);
        }
        return wrappedResponse.data as T;
      }

      return response as T;

    } catch (authError) {
      console.error('[ApiClient] AuthClient fetch failed:', authError);

      // Fallback to manual approach with session headers
      console.log('[ApiClient] Trying fallback with manual session headers...');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      };

      // Try to add session info manually using Better Auth's session data
      if (sessionResult.data?.session?.id) {
        // Some backends expect the session ID in a cookie-like format
        headers['Cookie'] = `better-auth.session-token=${sessionResult.data.session.id}`;
        console.log('[ApiClient] Added session cookie header');
      }

      const config: RequestInit = {
        credentials: 'include',
        headers,
        ...options,
      };

      console.log('[ApiClient] Fallback request config:', {
        credentials: config.credentials,
        headers: config.headers,
        hasBody: !!config.body,
        hasCookieHeader: !!headers['Cookie']
      });

      try {
        const response = await fetch(url, config);

        console.log('[ApiClient] Fallback response received:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        });

        const data = await response.json();

        console.log('[ApiClient] Fallback response data:', data);

        if (!response.ok) {
          console.error('[ApiClient] Fallback request failed:', {
            status: response.status,
            statusText: response.statusText,
            error: data.error,
            data
          });
          throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        return data;
      } catch (err) {
        console.error('[ApiClient] Fallback request exception:', {
          name: err instanceof Error ? err.name : 'Unknown',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
        });
        throw err;
      }
    }
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
    fileUri: string,
    fileName: string,
    mimeType: string,
    cardData?: {
      type?: Card['type'];
      data?: Record<string, any>;
      metaInfo?: Record<string, any>;
    },
    onProgress?: (progress: number) => void
  ): Promise<Card> {
    const apiBaseUrl = await getStoredApiUrl();
    const url = `${apiBaseUrl}/api/cards`;

    const formData = new FormData();

    // Create file object for React Native
    const fileData = {
      uri: fileUri,
      name: fileName,
      type: mimeType,
    } as any;

    formData.append('file', fileData);

    // Auto-detect card type based on file MIME type
    const detectedType = this.detectCardTypeFromFile(mimeType);
    const type = cardData?.type || detectedType;

    formData.append('type', type);

    if (cardData?.data) {
      formData.append('data', JSON.stringify(cardData.data));
    }

    if (cardData?.metaInfo) {
      formData.append('metaInfo', JSON.stringify(cardData.metaInfo));
    }

    try {
      // Try using authClient first
      if (authClient) {
        const response = await authClient.$fetch(url, {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        if (response && typeof response === 'object' && 'data' in response && 'error' in response) {
          const wrappedResponse = response as any;
          if (wrappedResponse.error) {
            const errorMessage = typeof wrappedResponse.error === 'string' ? wrappedResponse.error : wrappedResponse.error.message || 'Unknown error';
            throw new Error(errorMessage);
          }
          return wrappedResponse.data;
        }

        return response as Card;
      }

      // Fallback to regular fetch
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('File upload error:', error);
      throw error;
    }
  }

  private detectCardTypeFromFile(mimeType: string): Card['type'] {
    if (mimeType.startsWith('image/')) {
      return 'image';
    } else if (mimeType.startsWith('video/')) {
      return 'video';
    } else if (mimeType.startsWith('audio/')) {
      return 'audio';
    } else {
      // Default to image for unknown types
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
