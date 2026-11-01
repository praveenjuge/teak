import { useTranslations } from "@teak/i18n/react";
import { useMemo } from "react";
import {
  type ErrorKey,
  serverErrorMessage,
  translateErrorKey,
  translateServerMessage,
} from "@/lib/serverErrors";

export const useServerErrors = () => {
  const t = useTranslations("errors");
  return useMemo(
    () => ({
      byKey: (key: ErrorKey) => translateErrorKey(t, key),
      byEnglishMessage: (message: string) => translateServerMessage(t, message),
      message: (error: unknown, fallback: string) =>
        serverErrorMessage(t, error, fallback),
    }),
    [t]
  );
};
