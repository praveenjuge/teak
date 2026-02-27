import { setFeedbackStatus } from "@/lib/feedbackBridge";

export function showSavingFeedback(message = "Saving...") {
  setFeedbackStatus({
    dismissAfterMs: -1,
    iconName: "hourglass",
    message,
  });
}

export function showSuccessFeedback(
  message = "Saved Successfully!",
  dismissAfterMs = 1200
) {
  setFeedbackStatus({
    dismissAfterMs,
    iconName: "checkmark.circle.fill",
    message,
  });
}

export function showErrorFeedback(message: string, dismissAfterMs = 4000) {
  setFeedbackStatus({
    dismissAfterMs,
    iconName: "exclamationmark.triangle.fill",
    message,
  });
}

export function showInfoFeedback(message: string, dismissAfterMs = 2500) {
  setFeedbackStatus({
    dismissAfterMs,
    iconName: "info.circle.fill",
    message,
  });
}
