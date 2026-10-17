import type { CreateCardInput } from "@teak/convex/sdk";

/**
 * Create-card body fields for the public REST API, read by AutoTypeTable in
 * the API guide. Derived from the SDK's `CreateCardInput`, whose JSDoc
 * supplies each row's description. The upload fields are documented in the
 * guide's "Upload files" section instead.
 */
export type CreateCardBody = Omit<CreateCardInput, CreateCardUploadField>;

export type CreateCardUploadField =
  | "fileEtag"
  | "fileKey"
  | "fileName"
  | "fileSize"
  | "mimeType";
