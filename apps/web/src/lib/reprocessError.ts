import type { TeakTranslator } from "@teak/i18n";
import { englishErrors, englishTranslator } from "./englishTranslators";
import { type ErrorsTranslator, translateServerMessage } from "./serverErrors";

export type ReprocessTranslator = TeakTranslator<"lib.reprocess">;

const englishReprocess: ReprocessTranslator =
  englishTranslator("lib.reprocess");

const USER_FACING_CODES = new Set(["CONFLICT", "NOT_FOUND", "RATE_LIMITED"]);

export function getReprocessErrorMessage(
  error: unknown,
  t: ReprocessTranslator = englishReprocess,
  errors: ErrorsTranslator = englishErrors
): string {
  if (!error || typeof error !== "object") {
    return t("failed");
  }
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") {
    return t("failed");
  }
  const { code, message } = data as { code?: unknown; message?: unknown };
  return typeof code === "string" &&
    USER_FACING_CODES.has(code) &&
    typeof message === "string" &&
    message.trim()
    ? translateServerMessage(errors, message)
    : t("failed");
}
