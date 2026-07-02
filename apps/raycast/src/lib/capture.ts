import { open, showToast, Toast } from "@raycast/api";
import {
  type CreateCardInput,
  createCard,
  getRecoveryHint,
  getUserFacingErrorMessage,
} from "./api";
import { hasStoredTeakSession } from "./oauth";
import { getPreferences } from "./preferences";

const URL_INLINE_PATTERN = /(https?:\/\/[^\s]+)/i;

// True when the extension already holds usable credentials (a configured API
// key or a stored OAuth session) WITHOUT launching sign-in. No-view commands
// gate on this so they never kick off the browser OAuth overlay as a side
// effect — the user signs in explicitly from a view command first.
export const hasUsableCredentials = async (): Promise<boolean> => {
  if (getPreferences().apiKey?.trim()) {
    return true;
  }
  return hasStoredTeakSession();
};

// Shared guard for no-view save commands. Shows a sign-in prompt and returns
// false when there are no usable credentials, so the command stops instead of
// triggering an interactive browser sign-in from the request path.
export const ensureCredentialsForNoViewCommand = async (): Promise<boolean> => {
  if (await hasUsableCredentials()) {
    return true;
  }

  await showToast({
    message:
      "Open the Search or Quick Save command to sign in with your browser, then run this command again.",
    style: Toast.Style.Failure,
    title: "Sign in to Teak",
  });
  return false;
};

export const extractFirstHttpUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // Fall back to inline extraction below.
  }

  const match = trimmed.match(URL_INLINE_PATTERN);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = new URL(match[1]);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? match[1]
      : null;
  } catch {
    return null;
  }
};

export const saveCardWithFeedback = async (
  input: CreateCardInput,
  options: {
    loadingTitle: string;
  },
) => {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: options.loadingTitle,
  });

  try {
    const result = await createCard(input);

    const appUrl = result.appUrl;
    if (appUrl) {
      toast.primaryAction = {
        onAction: () => {
          void open(appUrl);
        },
        title: "Open Card",
      };
    }

    const sourceUrl = result.card?.url;
    if (sourceUrl) {
      toast.secondaryAction = {
        onAction: () => {
          void open(sourceUrl);
        },
        title: "Open Source URL",
      };
    }

    toast.style = Toast.Style.Success;
    toast.title = "Saved to Teak";

    return result;
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Save failed";
    const hint = getRecoveryHint(error);
    toast.message = hint
      ? `${getUserFacingErrorMessage(error)} ${hint}`
      : getUserFacingErrorMessage(error);
    throw error;
  }
};
