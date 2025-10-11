import { useCallback, useEffect, useMemo, useRef } from "react";
import { router, Stack } from "expo-router";
import {
  ShareIntent,
  ShareIntentFile,
  useShareIntentContext,
} from "expo-share-intent";
import { useAuth } from "@clerk/clerk-expo";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { useCreateCard } from "@/lib/hooks/useCardOperations";
import { useFileUpload } from "@/lib/hooks/useFileUpload";
import {
  setFeedbackStatus,
  type FeedbackStatusPayload,
} from "@/lib/feedbackBridge";

const SUCCESS_ICON = "checkmark.circle.fill";
const ERROR_ICON = "exclamationmark.triangle.fill";
const SAVING_ICON = "hourglass";

function normalizePath(path: string | null | undefined) {
  if (!path) {
    return null;
  }

  if (path.startsWith("file://") || path.startsWith("content://")) {
    return path;
  }

  return `file://${path}`;
}

function buildSharedText(intent: ShareIntent) {
  const pieces = [
    intent.text?.trim() ?? "",
    intent.webUrl?.trim() ?? "",
  ].filter((value) => value.length > 0);

  if (pieces.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  const uniquePieces = pieces.filter((piece) => {
    if (seen.has(piece)) {
      return false;
    }
    seen.add(piece);
    return true;
  });

  return uniquePieces.join("\n");
}

async function uploadSharedFile(
  file: ShareIntentFile,
  options: {
    uploadFile: ReturnType<typeof useFileUpload>["uploadFile"];
    fallbackContent?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const normalizedPath = normalizePath(file.path);
  if (!normalizedPath) {
    throw new Error("Unable to access shared file path");
  }

  const response = await fetch(normalizedPath);
  if (!response.ok) {
    throw new Error("Unable to read shared file");
  }

  const blob = await response.blob();
  const fileName = file.fileName || `shared-${Date.now()}`;
  const fileType = file.mimeType || blob.type || "application/octet-stream";
  const rnFile = new File([blob], fileName, { type: fileType });

  const result = await options.uploadFile(rnFile, {
    content: options.fallbackContent ?? fileName,
    additionalMetadata: {
      source: "share_intent",
      mimeType: file.mimeType,
      fileSize: file.size ?? blob.size,
      width: file.width ?? undefined,
      height: file.height ?? undefined,
      duration: file.duration ?? undefined,
      ...options.metadata,
    },
  });

  if (!result.success) {
    const error = new Error(result.error || "Failed to upload shared file");
    if (result.errorCode) {
      (error as Error & { code?: string }).code = result.errorCode;
    }
    throw error;
  }
}

export default function ShareIntentScreen() {
  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntentContext();
  const { isLoaded, isSignedIn } = useAuth();
  const createCard = useCreateCard();
  const { uploadFile } = useFileUpload();
  const isProcessingRef = useRef(false);
  const feedbackVisibleRef = useRef(false);

  const sharedText = useMemo(
    () => (shareIntent ? buildSharedText(shareIntent) : undefined),
    [shareIntent]
  );

  const showFeedback = useCallback((payload: FeedbackStatusPayload) => {
    if (!feedbackVisibleRef.current) {
      feedbackVisibleRef.current = true;
      router.replace("/(feedback)");
    }
    setFeedbackStatus(payload);
  }, []);

  const handleShareIntent = useCallback(
    async (intent: ShareIntent) => {
      const files = intent.files?.filter((file) => !!file.path) ?? [];
      const metadata: Record<string, unknown> = {
        sharedVia: "share_sheet",
      };

      if (intent.meta && Object.keys(intent.meta).length > 0) {
        metadata.shareMeta = intent.meta;
      }

      if (intent.webUrl) {
        metadata.webUrl = intent.webUrl;
      }

      if (sharedText) {
        metadata.sharedText = sharedText;
      }

      if (files.length === 0) {
        if (!sharedText) {
          throw new Error("Shared content is empty");
        }
        await createCard({
          content: sharedText,
        });
        return 1;
      }

      let savedCount = 0;
      let lastError: Error | null = null;

      for (const file of files) {
        try {
          await uploadSharedFile(file, {
            uploadFile,
            fallbackContent: sharedText,
          });
          savedCount += 1;
        } catch (uploadError) {
          lastError = uploadError instanceof Error ? uploadError : null;
        }
      }

      if (savedCount === 0) {
        throw lastError ?? new Error("Failed to save shared files");
      }

      return savedCount;
    },
    [createCard, sharedText, uploadFile]
  );

  useEffect(() => {
    if (error) {
      showFeedback({
        title: "Unable to Save",
        message: error,
        iconName: ERROR_ICON,
        accentColor: "#ff3b30",
        dismissAfterMs: 4000,
      });
      resetShareIntent();
      feedbackVisibleRef.current = false;
    }
  }, [error, resetShareIntent, showFeedback]);

  useEffect(() => {
    if (
      !hasShareIntent ||
      !shareIntent ||
      isProcessingRef.current ||
      !isLoaded
    ) {
      return;
    }

    if (!isSignedIn) {
      showFeedback({
        title: "Save to Teak",
        message: "Please sign in to save from the share sheet.",
        iconName: ERROR_ICON,
        accentColor: "#ff3b30",
        dismissAfterMs: 4000,
      });
      resetShareIntent();
      feedbackVisibleRef.current = false;
      return;
    }

    isProcessingRef.current = true;

    (async () => {
      try {
        showFeedback({
          title: "Save to Teak",
          message: "Saving...",
          iconName: SAVING_ICON,
          dismissAfterMs: -1,
        });

        const savedCount = await handleShareIntent(shareIntent);
        const message =
          savedCount > 1
            ? `Saved ${savedCount} items to Teak!`
            : "Saved to Teak!";

        showFeedback({
          title: "Save to Teak",
          message,
          iconName: SUCCESS_ICON,
          dismissAfterMs: 2000,
        });
      } catch (shareError) {
        let message = "Failed to save shared content. Please try again.";
        let accentColor = "#ff3b30";

        if (
          shareError &&
          typeof shareError === "object" &&
          "code" in shareError &&
          (shareError as Error & { code?: string }).code ===
            CARD_ERROR_CODES.CARD_LIMIT_REACHED
        ) {
          message =
            "You've reached your card limit. Upgrade your plan to keep saving.";
        } else if (shareError instanceof Error && shareError.message) {
          message = shareError.message;
        }

        showFeedback({
          title: "Unable to Save",
          message,
          iconName: ERROR_ICON,
          accentColor,
          dismissAfterMs: 4000,
        });
      } finally {
        resetShareIntent();
        feedbackVisibleRef.current = false;
        isProcessingRef.current = false;
      }
    })();
  }, [
    handleShareIntent,
    hasShareIntent,
    isLoaded,
    isSignedIn,
    resetShareIntent,
    shareIntent,
    showFeedback,
  ]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          presentation: "transparentModal",
          animation: "none",
        }}
      />
    </>
  );
}
