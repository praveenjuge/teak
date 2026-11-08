import type { TeakTranslator } from "@teak/i18n";
import { toast } from "sonner";

export type ClipboardTranslator = TeakTranslator<"lib.clipboard">;

export interface CopyTextMessages {
  copied: string;
  failed: string;
}

/**
 * Copies text and says so in a toast, or that it couldn't. `text` may be a
 * promise, so a caller can start the copy within the click. Returns whether
 * it copied.
 */
export async function copyText(
  text: string | Promise<string>,
  { copied, failed }: CopyTextMessages,
  toastId?: string | number
): Promise<boolean> {
  const show = (notify: typeof toast.success, message: string) =>
    toastId === undefined ? notify(message) : notify(message, { id: toastId });
  try {
    await navigator.clipboard.writeText(await text);
    show(toast.success, copied);
    return true;
  } catch (error) {
    console.error("Failed to copy", error);
    show(toast.error, failed);
    return false;
  }
}

export async function copyColorHexToClipboard(
  hex: string,
  t: ClipboardTranslator
) {
  await copyText(hex, {
    copied: t("copiedColor", { hex }),
    failed: t("copyFailed"),
  });
}
