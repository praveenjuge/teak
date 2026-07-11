/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_CONVEX_SITE_URL: string;
  readonly VITE_PUBLIC_CONVEX_URL: string;
  readonly VITE_WEB_URL?: string;
  readonly VITE_DESKTOP_UPDATE_CHANNEL?: string;
  readonly VITE_GIT_COMMIT_SHA?: string;
  readonly VITE_PUBLIC_SENTRY_DESKTOP_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
