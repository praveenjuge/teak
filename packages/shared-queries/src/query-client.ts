import { QueryClient } from '@tanstack/react-query';

export interface QueryClientOptions {
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
  retry?: number;
  retryDelay?: (attemptIndex: number) => number;
}

export function createQueryClient(options?: QueryClientOptions): QueryClient {
  const defaultOptions: QueryClientOptions = {
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
  };

  const mergedOptions = { ...defaultOptions, ...options };

  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: mergedOptions.staleTime,
        refetchOnWindowFocus: mergedOptions.refetchOnWindowFocus,
        retry: mergedOptions.retry,
        retryDelay: mergedOptions.retryDelay,
      },
    },
  });
}

// Pre-configured query clients for different environments
export const webQueryClient = createQueryClient({
  staleTime: 60 * 1000, // 1 minute for web
  retry: 1,
});

export const mobileQueryClient = createQueryClient({
  staleTime: 30 * 1000, // 30 seconds for mobile
  retry: 3,
});
