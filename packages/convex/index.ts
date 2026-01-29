// Client-safe exports only
// These can be safely imported in browser/React code

// API references for calling Convex functions
export { api, internal } from "./_generated/api";

// Type exports (no runtime code)
export type { Doc, Id } from "./_generated/dataModel";

// Shared utilities and constants (client-safe)
export * from "./shared";

// Note: Do NOT export Convex function implementations (query, mutation, action)
// from this file. They contain server-only code and will cause errors when
// imported in the browser. The frontend should only use `api.*` references
// to call functions, not the function implementations themselves.
