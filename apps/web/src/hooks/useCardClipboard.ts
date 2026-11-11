import { api } from "@teak/convex";
import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useAction } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import {
  type CopyableCard as CardToCopy,
  cardCopyKind,
  cardCopyText,
  resolveImageCopyUrl,
} from "@/lib/cardCopy";
import { copyText } from "@/lib/clipboard";
import { englishTranslator } from "@/lib/englishTranslators";
import { sizeSvgRoot } from "@/lib/svgSize";

export type ClipboardTranslator = TeakTranslator<"hooks.clipboard">;

const englishClipboard: ClipboardTranslator =
  englishTranslator("hooks.clipboard");

export interface CopyCardContentOptions {
  copyImageToastId?: string;
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

/** The image at `url` as a PNG, the one image type every browser copies. */
async function fetchImageAsPng(url: string): Promise<Blob> {
  const response = await fetch(url);
  // An error page is not the image: copy the link instead of the page.
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`Expected an image, got ${blob.type || "no type"}`);
  }
  if (blob.type === "image/png") {
    return blob;
  }
  if (blob.type === "image/svg+xml") {
    const svgText = await blob.text();
    const { width, height } = getSvgDimensions(svgText);
    const sized = new Blob([sizeSvgRoot(svgText, width, height)], {
      type: "image/svg+xml",
    });
    return convertToPng(sized, width, height);
  }
  return convertToPng(blob);
}

/**
 * Copies a card's text or image. Call it straight from the click or key
 * press, without awaiting anything first: Safari only lets the clipboard be
 * written during that gesture, so the image is handed over as a promise
 * that the clipboard waits for, and `content` may be one too.
 */
export async function copyCardContentToClipboard(
  content: string | Promise<string>,
  isImage: boolean,
  options: CopyCardContentOptions = {}
): Promise<void> {
  const imageToastId = options.copyImageToastId ?? DEFAULT_IMAGE_TOAST_ID;
  const t = options.t ?? englishClipboard;

  if (!isImage) {
    try {
      await navigator.clipboard.writeText(await content);
      toast.success(t("copied"));
      return;
    } catch (error) {
      // A write refused mid-gesture (the page lost focus) often works again.
      console.error("Failed to copy, trying again:", error);
    }
    await copyText(content, { copied: t("copied"), failed: t("copyFailed") });
    return;
  }
  try {
    toast.loading(t("copyingImage"), { id: imageToastId });
    const png = Promise.resolve(content).then(fetchImageAsPng);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast.success(t("imageCopied"), { id: imageToastId });
  } catch (error) {
    console.error("Failed to copy the image:", error);
    // An image the browser won't copy is still worth its link.
    await copyText(
      content,
      { copied: t("linkCopied"), failed: t("copyFailed") },
      imageToastId
    );
  }
}

export function useCardClipboard(options: CopyCardContentOptions = {}) {
  const { copyImageToastId } = options;
  const t = useTranslations("hooks.clipboard");

  const handleCopyImage = useCallback(
    async (content: string | Promise<string>, isImage: boolean) => {
      await copyCardContentToClipboard(content, isImage, {
        copyImageToastId,
        t,
      });
    },
    [copyImageToastId, t]
  );

  return { handleCopyImage };
}

interface CopyableCard extends CardToCopy {
  _id: string;
  fileKey?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
}

/**
 * Copies a card from the press that asked: an image card's original
 * picture, or the text or link `cardCopyKind` names. The open card copies an
 * image the same way (`copyImage`).
 */
export function useCopyCard() {
  const refresh = useAction(api.cards.refreshCardMediaUrl);
  const { handleCopyImage } = useCardClipboard();
  const copyImage = useCallback(
    (card: CopyableCard) => {
      // Started straight from the press: the clipboard write has to begin
      // before any await (see copyCardContentToClipboard).
      void handleCopyImage(
        resolveImageCopyUrl({
          cardId: card._id,
          fallbackUrl: card.fileUrl ?? card.thumbnailUrl ?? "",
          fileKey: card.fileKey,
          refresh,
        }),
        true
      );
    },
    [handleCopyImage, refresh]
  );
  const copy = useCallback(
    (card: CopyableCard) => {
      if (cardCopyKind(card) === "image") {
        copyImage(card);
        return;
      }
      const text = cardCopyText(card);
      if (text) {
        void handleCopyImage(text, false);
      }
    },
    [copyImage, handleCopyImage]
  );
  return { copy, copyImage };
}
