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
  title = "Error",
  icon: Icon = AlertCircle,
}: ErrorAlertProps) {
  if (!message) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
