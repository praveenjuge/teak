import type { TeakTranslator } from "@teak/i18n";
import { englishTranslator } from "./englishTranslators";

export type LinkTitleTranslator = TeakTranslator<"lib.linkTitle">;

const englishLinkTitle: LinkTitleTranslator =
  englishTranslator("lib.linkTitle");

export function resolveLinkTitle(
  card: {
    metadataTitle?: string;
    metadataTitleEdited?: boolean;
    previewTitle?: string;
    url?: string;
  },
  t: LinkTitleTranslator = englishLinkTitle
): string {
  return (
    (card.metadataTitleEdited ? card.metadataTitle : undefined) ||
    card.previewTitle ||
    card.metadataTitle ||
    card.url ||
    t("fallback")
  );
}
