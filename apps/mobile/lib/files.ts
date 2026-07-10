import {
  type FileFormat,
  type FilePreviewFacts,
  inferFileFormat,
  isGenericMimeType,
  MAX_FILE_SIZE,
  mimeTypeForFileName,
} from "@teak/convex/shared/file-formats";

interface NativeFileAsset {
  mimeType?: string | null;
  name: string;
  size?: number | null;
  uri: string;
}

export interface NormalizedNativeFile {
  fileName: string;
  fileSize: number | null;
  fileUri: string;
  mimeType: string;
}

export interface MobileFilePreviewInput {
  fileKind?: string;
  fileLanguage?: string;
  fileName?: string;
  fileUrl?: string | null;
  mimeType?: string;
  preview?: FilePreviewFacts;
  screenshotUrl?: string | null;
  thumbnailUrl?: string | null;
}

export interface MobileFilePreviewModel {
  facts: string[];
  format: FileFormat | null;
  imageFallback: string | null;
  imagePrimary: string | null;
  isAnimatedGif: boolean;
}

export interface NativeShareOptions {
  mimeType?: string;
  UTI?: string;
}

export const getNativeShareOptions = (
  fileName?: string
): NativeShareOptions => {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  const mimeType = fileName ? mimeTypeForFileName(fileName) : undefined;

  const utiByExtension: Record<string, string> = {
    gif: "com.compuserve.gif",
    jpeg: "public.jpeg",
    jpg: "public.jpeg",
    m4a: "public.mpeg-4-audio",
    mov: "com.apple.quicktime-movie",
    mp3: "public.mp3",
    mp4: "public.mpeg-4",
    pdf: "com.adobe.pdf",
    png: "public.png",
    txt: "public.plain-text",
    wav: "com.microsoft.waveform-audio",
  };
  const UTI = extension ? utiByExtension[extension] : undefined;

  return {
    ...(UTI ? { UTI } : {}),
    ...(mimeType && mimeType !== "application/octet-stream"
      ? { mimeType }
      : {}),
  };
};

export const getMobileFilePreview = (
  input: MobileFilePreviewInput
): MobileFilePreviewModel => {
  const format = input.fileName
    ? inferFileFormat({
        fileName: input.fileName,
        mimeType: input.mimeType,
      })
    : null;
  const preferThumbnail = format?.id === "heic" || format?.id === "svg";
  const facts = [
    input.fileLanguage,
    input.fileKind,
    typeof input.preview?.slideCount === "number"
      ? `${input.preview.slideCount} slides`
      : null,
    typeof input.preview?.archiveFileCount === "number"
      ? `${input.preview.archiveFileCount} files`
      : null,
    typeof input.preview?.archiveDirectoryCount === "number"
      ? `${input.preview.archiveDirectoryCount} folders`
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    facts,
    format,
    imageFallback: input.thumbnailUrl ?? input.screenshotUrl ?? null,
    imagePrimary: preferThumbnail
      ? (input.thumbnailUrl ?? null)
      : (input.fileUrl ?? null),
    isAnimatedGif: format?.id === "gif",
  };
};

export const normalizeNativeFileAsset = (
  asset: NativeFileAsset
): NormalizedNativeFile | null => {
  const format = inferFileFormat({
    fileName: asset.name,
    mimeType: asset.mimeType,
  });
  if (!format) {
    return null;
  }
  if (typeof asset.size === "number" && asset.size > MAX_FILE_SIZE) {
    return null;
  }

  return {
    fileName: asset.name,
    fileSize: asset.size ?? null,
    fileUri: asset.uri,
    mimeType: isGenericMimeType(asset.mimeType)
      ? format.mimeType
      : (asset.mimeType ?? format.mimeType),
  };
};
