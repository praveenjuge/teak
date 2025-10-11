// Export the generated Convex API for use in other packages
export { api, internal } from "./convex/_generated/api";

// Export types from the data model for TypeScript support
export type { Doc, Id } from "./convex/_generated/dataModel";

// Export shared utilities and constants that now live inside the backend package
export * from "./shared";
