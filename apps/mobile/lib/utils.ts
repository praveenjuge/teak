import { getStoredApiUrl } from './auth-client';

/**
 * Converts a relative media URL to a full URL by prepending the server URL
 * @param mediaUrl - The media URL from the API (could be relative or absolute)
 * @returns Full URL or null if no valid URL can be constructed
 */
export const getFullMediaUrl = (
  mediaUrl: string | undefined | null
): string | null => {
  if (!mediaUrl) {
    return null;
  }

  // If it's already a full URL (starts with http:// or https://), return as is
  if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
    return mediaUrl;
  }

  // Get the stored API URL
  const apiUrl = getStoredApiUrl();
  if (!apiUrl) {
    console.warn(
      '[Utils] No API URL configured, cannot construct full media URL'
    );
    return null;
  }

  // Remove trailing slash from API URL and leading slash from media URL if present
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const path = mediaUrl.startsWith('/') ? mediaUrl : `/${mediaUrl}`;

  const fullUrl = `${baseUrl}${path}`;
  console.log('[Utils] Constructed full media URL:', {
    mediaUrl,
    apiUrl,
    fullUrl,
  });

  return fullUrl;
};
