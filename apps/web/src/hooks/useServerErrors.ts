import { useTranslations } from "@teak/i18n/react";
import { useMemo } from "react";
import {
  type ErrorKey,
  serverErrorMessage,
  translateErrorKey,
  translateServerMessage,
} from "@/lib/serverErrors";

/** Translators for server errors and the client checks that mirror them. */
export const useServerErrors = () => {
  const t = useTranslations("errors");
  return useMemo(
    () => ({
      /** A known error by its catalog key, such as `"folders.EMPTY_NAME"`. */
      byKey: (key: ErrorKey) => translateErrorKey(t, key),
      /** Translates the English text from `FOLDER_ERROR_MESSAGES` and kin. */
      byEnglishMessage: (message: string) => translateServerMessage(t, message),
      message: (error: unknown, fallback: string) =>
        serverErrorMessage(t, error, fallback),
    }),
    [t]
  );
};
