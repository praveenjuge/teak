// A build reports only when TEAK_ANALYTICS_ENABLED is "true", to the
// token's own project: Teak's production Worker sets it, previews and local
// and self-hosted builds don't unless their owner opts in. No imports, so
// vite.config.ts can load it too.
export const resolvePostHogToken = (env: {
  analyticsEnabled?: string;
  token?: string;
}): string | undefined =>
  env.analyticsEnabled?.trim() === "true"
    ? env.token?.trim() || undefined
    : undefined;
