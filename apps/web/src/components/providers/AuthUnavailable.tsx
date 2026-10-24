"use client";

import { useTranslations } from "@teak/i18n/react";
import { StatusScreen } from "../StatusScreen";

export function AuthUnavailable({
  message,
  action,
  retry = () => window.location.reload(),
}: {
  message?: string;
  action?: string;
  retry?: () => void;
}) {
  const t = useTranslations("providers.authUnavailable");
  const tc = useTranslations("common");
  return (
    <StatusScreen
      action={action ?? tc("tryAgain")}
      message={message ?? t("message")}
      onAction={retry}
    />
  );
}
