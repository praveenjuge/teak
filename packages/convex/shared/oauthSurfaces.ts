// The apps that sign in to Teak with OAuth. Each one has its own WorkOS
// client ID in the discovery document.
export const OAUTH_SURFACES = ["cli", "raycast", "chrome", "firefox"] as const;
export type OAuthSurface = (typeof OAUTH_SURFACES)[number];
