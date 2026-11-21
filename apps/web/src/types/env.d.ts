// Vite sets NODE_ENV for both the browser and the Worker; Next.js used to
// declare it this way, and lib/public-env.ts relies on the narrow type.
// biome-ignore lint/style/noNamespace: @types/node declares ProcessEnv in the NodeJS namespace, so augmenting it needs one
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV?: "development" | "production" | "test";
  }
}
