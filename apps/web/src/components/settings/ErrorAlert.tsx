import { useTranslations } from "@teak/i18n/react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";

interface ErrorAlertProps {
  icon?: LucideIcon;
  message?: string | null;
  title?: string;
}

export function ErrorAlert({
  message,
  title,
  icon: Icon = AlertCircle,
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
