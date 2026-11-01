export const OAUTH_SURFACES = ["cli", "raycast", "chrome", "firefox"] as const;
export type OAuthSurface = (typeof OAUTH_SURFACES)[number];
