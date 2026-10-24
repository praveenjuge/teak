import { useTranslations } from "@teak/i18n/react";
import type { VadivamIcon } from "vadivam-react";
import { CircleAlert } from "vadivam-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";

interface ErrorAlertProps {
  icon?: VadivamIcon;
  message?: string | null;
  title?: string;
}

export function ErrorAlert({
  message,
  title,
  icon: Icon = CircleAlert,
}: ErrorAlertProps) {
  const t = useTranslations("settings.errorAlert");
  if (!message) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <Icon />
      <AlertTitle>{title ?? t("title")}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
