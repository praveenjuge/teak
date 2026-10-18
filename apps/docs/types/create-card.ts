import type { CreateCardInput } from "@teak/convex/sdk";

export type CreateCardBody = Omit<CreateCardInput, CreateCardUploadField>;

export type CreateCardUploadField =
  | "fileEtag"
  | "fileKey"
  | "fileName"
  | "fileSize"
  | "mimeType";
