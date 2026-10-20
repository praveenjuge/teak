"use client";

import { StatusScreen } from "../StatusScreen";

export function AuthUnavailable({
  message = "We couldn't check your session. Please try again.",
  action = "Try again",
  retry = () => window.location.reload(),
}: {
  message?: string;
  action?: string;
  retry?: () => void;
}) {
  return <StatusScreen action={action} message={message} onAction={retry} />;
}
