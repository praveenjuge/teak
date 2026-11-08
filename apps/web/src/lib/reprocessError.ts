import type { TeakTranslator } from "@teak/i18n";
import {
  convexErrorData,
  type ErrorsTranslator,
  translateServerMessage,
} from "./serverErrors";

export type ReprocessTranslator = TeakTranslator<"lib.reprocess">;

const USER_FACING_CODES = new Set(["CONFLICT", "NOT_FOUND", "RATE_LIMITED"]);

export function getReprocessErrorMessage(
  error: unknown,
  t: ReprocessTranslator,
  errors: ErrorsTranslator
): string {
  const { code, message } = convexErrorData(error);
  return code && USER_FACING_CODES.has(code) && message?.trim()
    ? translateServerMessage(errors, message)
    : t("failed");
}
