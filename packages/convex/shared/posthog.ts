/**
 * Shared PostHog configuration for the Teak monorepo.
 * Provides super properties to identify which app/package events originate from.
 */

export type AppSource =
  | "web"
  | "mobile"
  | "desktop"
  | "extension"
  | "convex"
  | "api"
  | "raycast";

export interface TeakSuperProperties {
  /** The environment (development, staging, production) */
  teak_environment: "development" | "staging" | "production";
  /** The source app/package that generated the event */
  teak_source: AppSource;
  /** The app version */
  teak_version?: string;
}

const getTeakEnvironment = (): TeakSuperProperties["teak_environment"] => {
  const nodeEnv = (
    globalThis as {
      process?: {
        env?: {
          NODE_ENV?: string;
        };
      };
    }
  ).process?.env?.NODE_ENV;

  return nodeEnv === "production" ? "production" : "development";
};

/**
 * Default super properties applied to all PostHog events.
 */
export const getDefaultSuperProperties = (
  source: AppSource,
  version?: string
): TeakSuperProperties => ({
  teak_source: source,
  teak_version: version,
  teak_environment: getTeakEnvironment(),
});

/**
 * Get super properties with additional custom properties merged in.
 */
export const getSuperProperties = (
  source: AppSource,
  customProperties?: Record<string, unknown>,
  version?: string
): Record<string, unknown> => ({
  ...getDefaultSuperProperties(source, version),
  ...customProperties,
});
