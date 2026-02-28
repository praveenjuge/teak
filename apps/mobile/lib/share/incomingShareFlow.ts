import type {
  IncomingShareStatus,
  NormalizedShareItem,
  ShareImportResult,
} from "@/lib/share/types";

export interface PreImportStatusInput {
  hasResolveError: boolean;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  isResolving: boolean;
  normalizedItemCount: number;
}

export function getPreImportStatus(
  input: PreImportStatusInput
): IncomingShareStatus {
  if (input.isLoadingAuth || input.isResolving) {
    return "resolving";
  }

  if (input.normalizedItemCount === 0) {
    return input.hasResolveError ? "error" : "empty";
  }

  if (!input.isAuthenticated) {
    return "authRequired";
  }

  return "saving";
}

export function createIncomingShareSignature(
  items: NormalizedShareItem[]
): string {
  if (items.length === 0) {
    return "";
  }

  return items
    .map((item) => {
      if (item.kind === "text") {
        return `${item.id}|text|${item.content}`;
      }

      return `${item.id}|file|${item.fileUri}|${item.fileName}|${item.mimeType}`;
    })
    .join("::");
}

export function getPostImportStatus(
  result: ShareImportResult
): IncomingShareStatus {
  if (result.successfulItems > 0 && result.failedItems === 0) {
    return "saved";
  }

  if (result.successfulItems > 0 && result.failedItems > 0) {
    return "partial";
  }

  return "error";
}
