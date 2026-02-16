/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_CONVEX_URL: string;
  readonly VITE_PUBLIC_CONVEX_SITE_URL: string;
  readonly VITE_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
