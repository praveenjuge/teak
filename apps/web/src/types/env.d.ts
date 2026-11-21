// Vite sets NODE_ENV for both the browser and the Worker; lib/public-env.ts
// relies on this narrow type.
// biome-ignore lint/style/noNamespace: @types/node declares ProcessEnv in the NodeJS namespace, so augmenting it needs one
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV?: "development" | "production" | "test";
  }
}

// The public values Vite inlines (vite.config.ts and the env contract in
// scripts/env). Unset ones are undefined.
interface ImportMetaEnv {
  readonly VITE_PUBLIC_APP_VERSION?: string;
  readonly VITE_PUBLIC_COMMIT_SHA?: string;
  readonly VITE_PUBLIC_CONVEX_SITE_URL?: string;
  readonly VITE_PUBLIC_CONVEX_URL?: string;
  readonly VITE_PUBLIC_FILES_BASE?: string;
  readonly VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_PUBLIC_WORKOS_REDIRECT_URI?: string;
}
