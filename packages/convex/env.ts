import { env } from "./_generated/server";

/**
 * Typed backend environment resolvers.
 *
 * Variables are declared in convex.config.ts (`defineApp({ env })`) and read
 * here through the generated typed `env` object. Groups are independently
 * optional: an absent group disables its capability, while a partially set
 * group is a configuration error that names the missing variables.
 */

export const readSiteUrl = (): string => {
  const siteUrl = env.SITE_URL;
  if (!siteUrl) {
    throw new Error(
      "SITE_URL environment variable is required. " +
        "Run: bunx convex env set SITE_URL http://localhost:3000"
    );
  }
  try {
    return new URL(siteUrl).toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      `SITE_URL environment variable is not a valid URL (received: "${siteUrl}"). ` +
        "Example: http://localhost:3000"
    );
  }
};

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Google capability group. Returns undefined when the whole group is absent
 * (Google auth disabled, everything else runs); throws when only one half
 * of the pair is set.
 */
export const getGoogleCredentials = (): GoogleCredentials | undefined => {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }
  if (!(clientId || clientSecret)) {
    return;
  }
  const missing = clientId ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID";
  throw new Error(
    `${missing} environment variable is required when its Google pair is set. ` +
      "Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither."
  );
};

export interface AppleCredentials {
  appBundleIdentifier?: string;
  clientId: string;
  keyId: string;
  privateKey: string;
  teamId: string;
}

/**
 * Apple capability group. Returns undefined when the whole group is absent
 * (Apple auth disabled, everything else runs); throws naming every missing
 * variable when partially set. Call at Apple sign-in time, never at boot.
 */
export const getAppleCredentials = (): AppleCredentials | undefined => {
  const clientId = env.APPLE_CLIENT_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  const privateKey = env.APPLE_PRIVATE_KEY?.trim();
  const teamId = env.APPLE_TEAM_ID?.trim();
  const appBundleIdentifier = env.APPLE_APP_BUNDLE_IDENTIFIER?.trim();
  if (clientId && keyId && privateKey && teamId) {
    return {
      clientId,
      keyId,
      privateKey,
      teamId,
      ...(appBundleIdentifier ? { appBundleIdentifier } : {}),
    };
  }
  if (!(clientId || keyId || privateKey || teamId || appBundleIdentifier)) {
    return;
  }
  const missing = [
    ["APPLE_CLIENT_ID", clientId],
    ["APPLE_KEY_ID", keyId],
    ["APPLE_PRIVATE_KEY", privateKey],
    ["APPLE_TEAM_ID", teamId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  throw new Error(
    `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required for Apple sign-in. ` +
      "Set the full Apple group, or none of it."
  );
};
