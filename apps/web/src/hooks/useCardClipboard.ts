import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { englishTranslator } from "@/lib/englishTranslators";
import { sizeSvgRoot } from "@/lib/svgSize";

export type ClipboardTranslator = TeakTranslator<"hooks.clipboard">;

const englishClipboard: ClipboardTranslator =
  englishTranslator("hooks.clipboard");

export interface CopyCardContentOptions {
  copyImageToastId?: string;
  /** The toasts' text; English without one. */
  t?: ClipboardTranslator;
}

const DEFAULT_IMAGE_TOAST_ID = "copy-image";

function convertToPng(
  blob: Blob,
  fallbackWidth = 500,
  fallbackHeight = 500
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(blob);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      const width = img.naturalWidth || img.width || fallbackWidth;
      const height = img.naturalHeight || img.height || fallbackHeight;
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(blobUrl);

      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
        } else {
          reject(new Error("Failed to create PNG blob"));
        }
      }, "image/png");
    };

    img.onerror = (error) => {
      URL.revokeObjectURL(blobUrl);
      reject(error);
    };

    img.src = blobUrl;
  });
}

function getSvgDimensions(svgText: string): { width: number; height: number } {
  const viewBoxMatch = svgText.match(/viewBox=["']([^"']+)["']/);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/);
    if (parts.length === 4) {
      return { width: Number(parts[2]), height: Number(parts[3]) };
    }
  }

  const widthMatch = svgText.match(/width=["'](\d+(?:\.\d+)?)["']/);
  const heightMatch = svgText.match(/height=["'](\d+(?:\.\d+)?)["']/);
  if (widthMatch && heightMatch) {
    return { width: Number(widthMatch[1]), height: Number(heightMatch[1]) };
  }

  return { width: 500, height: 500 };
}

function getErrorName(error: unknown): string {
  if (error instanceof DOMException) {
    return error.name;
  }
  if (typeof error === "object" && error !== null && "name" in error) {
    return String(error.name);
  }
  return "";
}

export async function copyCardContentToClipboard(
  content: string,
  isImage: boolean,
  options: CopyCardContentOptions = {}
): Promise<void> {
  const imageToastId = options.copyImageToastId ?? DEFAULT_IMAGE_TOAST_ID;
  const t = options.t ?? englishClipboard;

  if (isImage) {
    toast.loading(t("copyingImage"), { id: imageToastId });
  }

  try {
    if (isImage) {
      const response = await fetch(content);
      const blob = await response.blob();

      try {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
        toast.success(t("imageCopied"), { id: imageToastId });
        return;
      } catch (originalError) {
        const errorName = getErrorName(originalError);

        if (errorName === "NotAllowedError") {
          if (blob.type === "image/svg+xml") {
            const svgText = await blob.text();
            const { width, height } = getSvgDimensions(svgText);
            const svgWithDimensions = sizeSvgRoot(svgText, width, height);
            const sizedBlob = new Blob([svgWithDimensions], {
              type: "image/svg+xml",
            });

            const pngBlob = await convertToPng(sizedBlob, width, height);
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": pngBlob }),
            ]);
            toast.success(t("imageCopied"), { id: imageToastId });
            return;
          }

          const pngBlob = await convertToPng(blob);
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": pngBlob }),
          ]);
          toast.success(t("imageCopied"), { id: imageToastId });
          return;
        }

        throw originalError;
      }
    }

    await navigator.clipboard.writeText(content);
    toast.success(t("copied"));
  } catch (error) {
    console.error("Failed to copy:", error);

    try {
      await navigator.clipboard.writeText(content);
      toast.success(t("linkCopied"), { id: imageToastId });
    } catch {
      toast.error(t("copyFailed"), { id: imageToastId });
    }
  }
}

export function useCardClipboard(options: CopyCardContentOptions = {}) {
  const { copyImageToastId } = options;
  const t = useTranslations("hooks.clipboard");

  const handleCopyImage = useCallback(
    async (content: string, isImage: boolean) => {
      await copyCardContentToClipboard(content, isImage, {
        copyImageToastId,
        t,
      });
    },
    [copyImageToastId, t]
  );

  return { handleCopyImage };
}
