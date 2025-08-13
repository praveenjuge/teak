import { useSearchFilters as useBaseSearchFilters } from "@teak/shared";

export function useSearchFilters() {
  return useBaseSearchFilters({
    searchLimit: 100,
  });
}
