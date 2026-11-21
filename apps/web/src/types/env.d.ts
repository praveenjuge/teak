// Vite sets NODE_ENV for both the browser and the Worker; lib/public-env.ts
// relies on this narrow type.
// biome-ignore lint/style/noNamespace: @types/node declares ProcessEnv in the NodeJS namespace, so augmenting it needs one
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV?: "development" | "production" | "test";
  }
}
