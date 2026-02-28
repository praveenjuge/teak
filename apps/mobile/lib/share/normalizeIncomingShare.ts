import type { ResolvedSharePayload, SharePayload } from "expo-sharing";
import type {
  DroppedSharePayload,
  NormalizedShareItem,
  NormalizedShareSource,
  NormalizeIncomingShareInput,
  NormalizeIncomingShareResult,
} from "@/lib/share/types";

type SupportedFileShareType = "audio" | "file" | "image" | "video";

const FILE_SHARE_TYPES = new Set<SupportedFileShareType>([
  "audio",
  "file",
  "image",
  "video",
]);

const DEFAULT_MIME_BY_SHARE_TYPE: Record<string, string> = {
  audio: "audio/mpeg",
  file: "application/octet-stream",
  image: "image/jpeg",
  video: "video/mp4",
};

type ShareLikePayload = ResolvedSharePayload | SharePayload;

interface PayloadAdapter<TPayload extends ShareLikePayload> {
  getEmptyFileUriMessage: (index: number) => string;
  getEmptyTextMessage: (index: number) => string;
  getFileName: (payload: TPayload, fileUri: string, index: number) => string;
  getFileSize: (payload: TPayload) => number | null;
  getFileUri: (payload: TPayload) => string | null;
  getMimeType: (payload: TPayload, shareType: string) => string;
  getShareType: (payload: TPayload) => string;
  getTextCandidate: (payload: TPayload, shareType: string) => string | null;
  getUnsupportedTypeMessage: (index: number, shareType: string) => string;
  source: NormalizedShareSource;
}

function buildItemId(
  source: NormalizedShareSource,
  index: number,
  seed: string
) {
  const normalizedSeed = encodeURIComponent(seed.trim().slice(0, 120));
  return `${source}-${index}-${normalizedSeed}`;
}

function inferFileNameFromUri(uri: string, index: number): string {
  try {
    const parsed = new URL(uri);
    const pathPart = parsed.pathname.split("/").filter(Boolean).pop();
    if (pathPart) {
      return decodeURIComponent(pathPart);
    }
  } catch {
    const withoutQuery = uri.split("?")[0] ?? uri;
    const pathPart = withoutQuery.split("/").filter(Boolean).pop();
    if (pathPart) {
      return decodeURIComponent(pathPart);
    }
  }

  return `shared-file-${index + 1}`;
}

function normalizeTextValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapPayload<TPayload extends ShareLikePayload>(
  payload: TPayload,
  index: number,
  dropped: DroppedSharePayload[],
  adapter: PayloadAdapter<TPayload>
): NormalizedShareItem | null {
  const shareType = adapter.getShareType(payload);

  if (shareType === "text" || shareType === "url") {
    const textCandidate = adapter.getTextCandidate(payload, shareType);
    if (!textCandidate) {
      dropped.push({
        reason: "EMPTY_VALUE",
        message: adapter.getEmptyTextMessage(index),
      });
      return null;
    }

    return {
      id: buildItemId(adapter.source, index, textCandidate),
      source: adapter.source,
      kind: "text",
      content: textCandidate,
    };
  }

  if (!FILE_SHARE_TYPES.has(shareType as SupportedFileShareType)) {
    dropped.push({
      reason: "UNSUPPORTED_TYPE",
      message: adapter.getUnsupportedTypeMessage(index, shareType),
    });
    return null;
  }

  const fileUri = adapter.getFileUri(payload);
  if (!fileUri) {
    dropped.push({
      reason: "EMPTY_VALUE",
      message: adapter.getEmptyFileUriMessage(index),
    });
    return null;
  }

  const fileName = adapter.getFileName(payload, fileUri, index);
  const mimeType = adapter.getMimeType(payload, shareType);

  return {
    id: buildItemId(adapter.source, index, `${fileUri}|${fileName}`),
    source: adapter.source,
    kind: "file",
    fileUri,
    fileName,
    mimeType,
    content: fileName,
    fileSize: adapter.getFileSize(payload),
  };
}

function mapPayloads<TPayload extends ShareLikePayload>(
  payloads: TPayload[],
  adapter: PayloadAdapter<TPayload>
): NormalizeIncomingShareResult {
  const dropped: DroppedSharePayload[] = [];
  const items: NormalizedShareItem[] = payloads
    .map((payload, index) => mapPayload(payload, index, dropped, adapter))
    .filter((item): item is NormalizedShareItem => item !== null);

  return {
    source: adapter.source,
    dropped,
    items,
  };
}

const resolvedPayloadAdapter: PayloadAdapter<ResolvedSharePayload> = {
  source: "resolved",
  getShareType: (payload) => payload.shareType,
  getTextCandidate: (payload, shareType) =>
    shareType === "url"
      ? normalizeTextValue(payload.contentUri ?? payload.value)
      : normalizeTextValue(payload.value),
  getFileUri: (payload) =>
    normalizeTextValue(payload.contentUri ?? payload.value),
  getFileName: (payload, fileUri, index) =>
    normalizeTextValue(payload.originalName) ??
    inferFileNameFromUri(fileUri, index),
  getMimeType: (payload, shareType) =>
    normalizeTextValue(payload.contentMimeType) ??
    normalizeTextValue(payload.mimeType) ??
    DEFAULT_MIME_BY_SHARE_TYPE[shareType] ??
    "application/octet-stream",
  getFileSize: (payload) =>
    typeof payload.contentSize === "number" ? payload.contentSize : null,
  getUnsupportedTypeMessage: (index, shareType) =>
    `Resolved share item ${index + 1} has unsupported type "${shareType}".`,
  getEmptyTextMessage: (index) =>
    `Resolved share item ${index + 1} has no text value.`,
  getEmptyFileUriMessage: (index) =>
    `Resolved share file item ${index + 1} has no URI.`,
};

const rawPayloadAdapter: PayloadAdapter<SharePayload> = {
  source: "raw",
  getShareType: (payload) => payload.shareType,
  getTextCandidate: (payload) => normalizeTextValue(payload.value),
  getFileUri: (payload) => normalizeTextValue(payload.value),
  getFileName: (_payload, fileUri, index) =>
    inferFileNameFromUri(fileUri, index),
  getMimeType: (payload, shareType) =>
    normalizeTextValue(payload.mimeType) ??
    DEFAULT_MIME_BY_SHARE_TYPE[shareType] ??
    "application/octet-stream",
  getFileSize: () => null,
  getUnsupportedTypeMessage: (index, shareType) =>
    `Shared item ${index + 1} has unsupported type "${shareType}".`,
  getEmptyTextMessage: (index) => `Shared text item ${index + 1} has no value.`,
  getEmptyFileUriMessage: (index) =>
    `Shared file item ${index + 1} has no URI.`,
};

export function normalizeIncomingSharePayloads(
  input: NormalizeIncomingShareInput
): NormalizeIncomingShareResult {
  if (input.resolvedSharedPayloads.length > 0) {
    return mapPayloads(input.resolvedSharedPayloads, resolvedPayloadAdapter);
  }

  if (input.sharedPayloads.length > 0) {
    return mapPayloads(input.sharedPayloads, rawPayloadAdapter);
  }

  return {
    source: "none",
    dropped: [],
    items: [],
  };
}
