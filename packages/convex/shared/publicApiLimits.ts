export const PUBLIC_API_DEFAULT_LIMIT = 50;
export const PUBLIC_API_MAX_LIMIT = 100;
export const PUBLIC_API_MAX_BULK_ITEMS = 100;

export const clampPublicApiLimit = (limit?: number): number => {
  if (!(typeof limit === "number" && Number.isFinite(limit))) {
    return PUBLIC_API_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(limit, PUBLIC_API_MAX_LIMIT));
};
