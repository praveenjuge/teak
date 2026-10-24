import {
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MIME_TYPES,
  toThumbnailMimeType,
} from "@teak/convex/shared/thumbnails";
import type { TeakTranslator } from "@teak/i18n";
import {
  englishErrors,
  englishTranslator,
  translateServerMessage,
} from "./englishTranslators";
import { type ErrorsTranslator, translateErrorKey } from "./serverErrors";

export const LINK_THUMBNAIL_ACCEPT = THUMBNAIL_MIME_TYPES.join(",");

export const firstFile = (
  files: ArrayLike<File> | null | undefined
): File | undefined => (files && files.length > 0 ? files[0] : undefined);

export const imageFromClipboard = (
  data: Pick<DataTransfer, "files" | "items"> | null
): File | undefined => {
  if (!data) {
    return;
  }
  const fromFiles = Array.from(data.files ?? []).find((file) =>
    file.type.startsWith("image/")
  );
  if (fromFiles) {
    return fromFiles;
  }
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile() ?? undefined;
    }
  }
};

export const linkThumbnailFileProblem = (
  file: {
    size: number;
    type: string;
  },
  errors: ErrorsTranslator = englishErrors
): string | null => {
  if (!toThumbnailMimeType(file.type)) {
    return translateErrorKey(errors, "thumbnails.unsupported");
  }
  if (file.size > THUMBNAIL_MAX_BYTES) {
    return translateErrorKey(errors, "thumbnails.tooLarge");
  }
  return null;
};

export type LinkThumbnailTranslator = TeakTranslator<"lib.linkThumbnail">;

const englishLinkThumbnail: LinkThumbnailTranslator =
  englishTranslator("lib.linkThumbnail");

export const linkThumbnailErrorMessage = (
  error: unknown,
  errors: ErrorsTranslator = englishErrors,
  t: LinkThumbnailTranslator = englishLinkThumbnail
): string => {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { code?: unknown; message?: unknown } }).data
      : undefined;
  switch (data?.code) {
    case "UNSUPPORTED_TYPE":
      return translateErrorKey(errors, "thumbnails.unsupported");
    case "FILE_TOO_LARGE":
      return translateErrorKey(errors, "thumbnails.tooLarge");
    case "INVALID_INPUT":
      return translateErrorKey(errors, "thumbnails.unreadable");
    case "RATE_LIMITED":
      return translateErrorKey(errors, "thumbnails.rateLimited");
    default:
      return typeof data?.message === "string"
        ? translateServerMessage(errors, data.message)
        : t("changeFailed");
  }
};

export const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target && typeof target === "object" && "tagName" in target)) {
    return false;
  }
  const element = target as HTMLElement;
  const tag = String(element.tagName).toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true ||
    Boolean(element.closest?.("[contenteditable='true'], [contenteditable='']"))
  );
};
