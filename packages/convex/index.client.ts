// The package entry. Its two dots keep Convex from bundling it as a function
// module: as one, its re-export of `api` would make the generated `api` type
// refer to itself, and TypeScript would read every function reference as
// `any` (`__tests__/typedApi.test.ts` checks it does not).
export { api, internal } from "./_generated/api";

export type { Doc, Id } from "./_generated/dataModel";

export * from "./devUrls";

export * from "./shared";
