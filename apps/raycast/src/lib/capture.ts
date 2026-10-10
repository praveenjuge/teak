import { statSync } from "node:fs";
import { open, showToast, Toast } from "@raycast/api";
import {
  type CreateCardInput,
  createCard,
  findSavedCardId,
  getRecoveryHint,
  getUserFacingErrorMessage,
  MAX_UPLOAD_BYTES,
  type QuickSaveResponse,
  saveFileCard,
} from "./api";
import { getTeakCardUrl } from "./constants";
import {
  getStoredTeakAccessToken,
  TeakDiscoveryError,
  TeakSignOutRequiredError,
} from "./oauth";
import { getPreferences } from "./preferences";

const URL_INLINE_PATTERN = /(https?:\/\/[^\s]+)/i;

// Shared guard for no-view save commands. Confirms usable credentials WITHOUT
// launching sign-in: an API key, or an existing OAuth session (silently
// refreshing an expired access token when possible). Refreshing here also means
// the subsequent request path finds a valid token and never opens the browser
// overlay. When there is no usable session (missing or stale/revoked), it shows
// recovery or sign-in guidance and returns false, stopping the command before
// interactive reauthorization from a background command.
export const ensureCredentialsForNoViewCommand = async (): Promise<boolean> => {
  if (getPreferences().apiKey?.trim()) {
    return true;
  }

  let token: string | null;
  try {
    token = await getStoredTeakAccessToken();
  } catch (error) {
    if (error instanceof TeakSignOutRequiredError) {
      await showToast({
        title: "Sign Out required",
        message: "Open Search Cards, choose Sign Out, then sign in again.",
        style: Toast.Style.Failure,
      });
      return false;
    }
    if (!(error instanceof TeakDiscoveryError)) {
      throw error;
    }
    await showToast({
      title: "Unable to reach Teak",
      message: "Check your connection and try again.",
      style: Toast.Style.Failure,
    });
    return false;
  }
  if (token) {
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

const failureMessage = (error: unknown): string => {
  const hint = getRecoveryHint(error);
  return hint
    ? `${getUserFacingErrorMessage(error)} ${hint}`
    : getUserFacingErrorMessage(error);
};

/** Accepts a plain path or a file:// URL, as Raycast's clipboard returns. */
export const toLocalPath = (value: string): string =>
  value.startsWith("file://")
    ? decodeURIComponent(new URL(value).pathname)
    : value;

export const isUploadableFile = (path: string): boolean => {
  try {
    const stats = statSync(path);
    return stats.isFile() && stats.size <= MAX_UPLOAD_BYTES;
  } catch {
    return false;
  }
};

/**
 * Uploads local files one at a time, like dropping them on the web, and
 * reports a single summary toast.
 */
export const saveFilesWithFeedback = async (
  paths: string[],
  source: string,
): Promise<QuickSaveResponse[]> => {
  const noun = paths.length === 1 ? "file" : `${paths.length} files`;
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `Uploading ${noun}…`,
  });
  const saved: QuickSaveResponse[] = [];
  let lastError: unknown;
  for (const [index, path] of paths.entries()) {
    if (paths.length > 1) {
      toast.message = `${index + 1} of ${paths.length}`;
    }
    try {
      saved.push(await saveFileCard(path, { source }, { interactive: false }));
    } catch (error) {
      lastError = error;
    }
  }
  toast.message = undefined;
  if (saved.length === 0) {
    toast.style = Toast.Style.Failure;
    toast.title = "Upload failed";
    toast.message = failureMessage(lastError);
    return saved;
  }
  toast.style = Toast.Style.Success;
  toast.title =
    saved.length === paths.length
      ? `Saved ${noun} to Teak`
      : `Saved ${saved.length} of ${paths.length} files`;
  if (lastError) {
    toast.message = failureMessage(lastError);
  }
  const first = saved[0];
  toast.primaryAction = {
    onAction: () => {
      void open(first?.appUrl ?? getTeakCardUrl(first?.cardId ?? ""));
    },
    title: saved.length === 1 ? "Open Card" : "Open First Card",
  };
  return saved;
};

/**
 * Shows "Already saved" with a way to open the existing card, so saving the
 * same page twice doesn't make a duplicate. Returns true when it was saved.
 */
export const showIfAlreadySaved = async (url: string): Promise<boolean> => {
  let cardId: string | null = null;
  try {
    cardId = await findSavedCardId(url, { interactive: false });
  } catch {
    // If the check fails, saving still works; the user can tidy up later.
    return false;
  }
  if (!cardId) {
    return false;
  }
  await showToast({
    primaryAction: {
      onAction: () => {
        void open(getTeakCardUrl(cardId));
      },
      title: "Open Card",
    },
    style: Toast.Style.Success,
    title: "Already saved",
  });
  return true;
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
    // No-view command: never open the sign-in overlay from the request path.
    const result = await createCard(input, { interactive: false });

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
    toast.message = failureMessage(error);
    throw error;
  }
};
