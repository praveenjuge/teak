import { useTranslations } from "@teak/i18n/react";
import { useMemo } from "react";
import {
  type ErrorKey,
  keyByEnglishMessage,
  serverErrorMessage,
  translateErrorKey,
} from "@/lib/serverErrors";

/** Translators for server errors and the client checks that mirror them. */
export const useServerErrors = () => {
  const t = useTranslations("errors");
  return useMemo(
    () => ({
      /** A known error by its catalog key, such as `"folders.EMPTY_NAME"`. */
      byKey: (key: ErrorKey) => translateErrorKey(t, key),
      /** Translates the English text from `FOLDER_ERROR_MESSAGES` and kin. */
      byEnglishMessage: (message: string) => {
        const key = keyByEnglishMessage.get(message);
        return key ? translateErrorKey(t, key) : message;
      },
      message: (error: unknown, fallback: string) =>
        serverErrorMessage(t, error, fallback),
    }),
    [t]
  );
};
