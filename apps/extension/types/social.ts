export type Platform = "x" | "instagram" | "pinterest";

export interface ExtractedPost {
  permalink: string;
  platform: Platform;
  postKey: string;
}

const SOCIAL_BASE_HOSTS = ["x.com", "instagram.com", "pinterest.com"] as const;

export const DESKTOP_SOCIAL_HOSTS = {
  x: ["x.com", "www.x.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  pinterest: ["pinterest.com", "www.pinterest.com"],
} as const;

export const INLINE_SAVE_ALLOWED_HOSTS = new Set<string>(
  Object.values(DESKTOP_SOCIAL_HOSTS).flat()
);

export const isSupportedSocialHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return SOCIAL_BASE_HOSTS.some(
    (baseHost) => normalized === baseHost || normalized.endsWith(`.${baseHost}`)
  );
};
