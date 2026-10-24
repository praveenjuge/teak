import type { TeakTranslator } from "@teak/i18n";
// Only the extension's English, not the whole catalog: content scripts run
// on every page, so they take the translated labels from the background.
import { extension } from "@teak/i18n/messages/en.json";

/** The inline "Save to Teak" button's words, one per state. */
export type InlineLabels = Record<keyof typeof extension.inline, string>;

/** Where `errorWithReason` takes the reason, which the content script adds. */
export const REASON_PLACEHOLDER = "{reason}";

/** Shown until the background answers. Its `{reason}` is the placeholder. */
export const ENGLISH_INLINE_LABELS: InlineLabels = extension.inline;

export const inlineLabels = (
  t: TeakTranslator<"extension.inline">
): InlineLabels => ({
  idle: t("idle"),
  saving: t("saving"),
  saved: t("saved"),
  duplicate: t("duplicate"),
  error: t("error"),
  errorWithReason: t("errorWithReason", { reason: REASON_PLACEHOLDER }),
  invalidPost: t("invalidPost"),
  signIn: t("signIn"),
  saveFailed: t("saveFailed"),
});

/** The failed label with its reason, for example the server's message. */
export const withReason = (labels: InlineLabels, reason: string): string =>
  labels.errorWithReason.split(REASON_PLACEHOLDER).join(reason);

export const isInlineLabels = (value: unknown): value is InlineLabels =>
  typeof value === "object" &&
  value !== null &&
  Object.keys(ENGLISH_INLINE_LABELS).every(
    (key) => typeof (value as Record<string, unknown>)[key] === "string"
  );
