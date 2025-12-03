import { useEffect, useRef } from "react";
import { router, Stack } from "expo-router";
import { ShareIntent, useShareIntentContext } from "expo-share-intent";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { useCreateCard } from "@/lib/hooks/useCardOperations";
import { useFileUpload } from "@/lib/hooks/useFileUpload";
import { setFeedbackStatus } from "@/lib/feedbackBridge";
import { authClient } from "@/lib/auth-client";

const ICONS = {
  success: "checkmark.circle.fill",
  error: "exclamationmark.triangle.fill",
  saving: "hourglass",
} as const;

const ERROR_COLOR = "#ff3b30";

function showFeedback(
  type: "success" | "error" | "saving",
  message: string,
  feedbackVisibleRef: React.RefObject<boolean>
) {
  if (!feedbackVisibleRef.current) {
    feedbackVisibleRef.current = true;
    router.replace("/(feedback)");
  }
  setFeedbackStatus({
    title: type === "error" ? "Unable to Save" : "Save to Teak",
    message,
    iconName: ICONS[type],
    accentColor: type === "error" ? ERROR_COLOR : undefined,
    dismissAfterMs: type === "saving" ? -1 : type === "error" ? 4000 : 2000,
  });
}

function getSharedText(intent: ShareIntent): string | undefined {
  const pieces = [intent.text?.trim(), intent.webUrl?.trim()].filter(
    (v): v is string => !!v
  );
  return [...new Set(pieces)].join("\n") || undefined;
}

function getErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === CARD_ERROR_CODES.CARD_LIMIT_REACHED
  ) {
    return "You've reached your card limit. Upgrade your plan to keep saving.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to save shared content. Please try again.";
}

async function processShareIntent(
  intent: ShareIntent,
  sharedText: string | undefined,
  createCard: ReturnType<typeof useCreateCard>,
  uploadFile: ReturnType<typeof useFileUpload>["uploadFile"]
): Promise<number> {
  const files = intent.files?.filter((f) => f.path) ?? [];

  if (files.length === 0) {
    if (!sharedText) throw new Error("Shared content is empty");
    await createCard({ content: sharedText });
    return 1;
  }

  let savedCount = 0;
  let lastError: Error | null = null;

  for (const file of files) {
    try {
      const path =
        file.path?.startsWith("file://") || file.path?.startsWith("content://")
          ? file.path
          : `file://${file.path}`;

      const response = await fetch(path);
      if (!response.ok) throw new Error("Unable to read shared file");

      const blob = await response.blob();
      const result = await uploadFile(
        new File([blob], file.fileName || `shared-${Date.now()}`, {
          type: file.mimeType || blob.type || "application/octet-stream",
        }),
        {
          content: sharedText ?? file.fileName ?? "",
          additionalMetadata: {
            source: "share_intent",
            mimeType: file.mimeType,
            fileSize: file.size ?? blob.size,
            width: file.width,
            height: file.height,
            duration: file.duration,
          },
        }
      );

      if (!result.success) {
        const err = new Error(result.error || "Failed to upload");
        if (result.errorCode)
          (err as Error & { code?: string }).code = result.errorCode;
        throw err;
      }
      savedCount++;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error("Upload failed");
    }
  }

  if (savedCount === 0)
    throw lastError ?? new Error("Failed to save shared files");
  return savedCount;
}

export default function ShareIntentScreen() {
  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntentContext();
  const { data: session, isPending } = authClient.useSession();
  const isSignedIn = !!session;
  const createCard = useCreateCard();
  const { uploadFile } = useFileUpload();
  const isProcessingRef = useRef(false);
  const feedbackVisibleRef = useRef(false);
  const createCardRef = useRef(createCard);
  const uploadFileRef = useRef(uploadFile);

  // Keep refs updated
  createCardRef.current = createCard;
  uploadFileRef.current = uploadFile;

  useEffect(() => {
    if (error) {
      showFeedback("error", error, feedbackVisibleRef);
      resetShareIntent();
      feedbackVisibleRef.current = false;
    }
  }, [error, resetShareIntent]);

  useEffect(() => {
    // Wait for auth to load
    if (isPending) return;

    // No share intent or already processing
    if (!hasShareIntent || !shareIntent || isProcessingRef.current) return;

    if (!isSignedIn) {
      showFeedback(
        "error",
        "Please sign in to save from the share sheet.",
        feedbackVisibleRef
      );
      resetShareIntent();
      feedbackVisibleRef.current = false;
      return;
    }

    // Mark as processing before any async work
    isProcessingRef.current = true;
    const sharedText = getSharedText(shareIntent);

    void (async () => {
      try {
        showFeedback("saving", "Saving...", feedbackVisibleRef);
        const count = await processShareIntent(
          shareIntent,
          sharedText,
          createCardRef.current,
          uploadFileRef.current
        );
        showFeedback(
          "success",
          count > 1 ? `Saved ${count} items to Teak!` : "Saved to Teak!",
          feedbackVisibleRef
        );
      } catch (e) {
        showFeedback("error", getErrorMessage(e), feedbackVisibleRef);
      } finally {
        resetShareIntent();
        feedbackVisibleRef.current = false;
        isProcessingRef.current = false;
      }
    })();
    // Only depend on stable values - isSignedIn is derived from session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent, shareIntent, isPending, isSignedIn, resetShareIntent]);

  return (
    <Stack.Screen
      options={{
        headerShown: false,
        presentation: "transparentModal",
        animation: "none",
      }}
    />
  );
}
