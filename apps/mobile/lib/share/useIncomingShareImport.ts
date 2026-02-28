import { useConvexAuth } from "convex/react";
import { type Href, useRouter } from "expo-router";
import { useIncomingShare } from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUploadFromUri } from "@/lib/hooks/use-upload-from-uri";
import { useCreateCard } from "@/lib/hooks/useCardOperations";
import {
  INCOMING_SHARE_AUTH_ROUTE,
  INCOMING_SHARE_HOME_ROUTE,
  INCOMING_SHARE_SUCCESS_REDIRECT_DELAY_MS,
} from "@/lib/share/constants";
import { importIncomingShareItems } from "@/lib/share/importIncomingShare";
import {
  createIncomingShareSignature,
  getPostImportStatus,
  getPreImportStatus,
} from "@/lib/share/incomingShareFlow";
import { normalizeIncomingSharePayloads } from "@/lib/share/normalizeIncomingShare";
import type { IncomingShareStatus } from "@/lib/share/types";

export interface UseIncomingShareImportResult {
  errorDetail: string | null;
  handleClose: () => void;
  handleOpenLogin: () => void;
  status: IncomingShareStatus;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function useIncomingShareImport(): UseIncomingShareImportResult {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const createCard = useCreateCard();
  const { uploadFromUri } = useUploadFromUri();
  const [status, setStatus] = useState<IncomingShareStatus>("resolving");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const processedSignatureRef = useRef("");
  const authRequiredHandledRef = useRef(false);
  const isProcessingRef = useRef(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    clearSharedPayloads,
    error: shareResolveError,
    isResolving,
    refreshSharePayloads,
    resolvedSharedPayloads,
    sharedPayloads,
  } = useIncomingShare();

  const normalized = useMemo(
    () =>
      normalizeIncomingSharePayloads({
        resolvedSharedPayloads,
        sharedPayloads,
      }),
    [resolvedSharedPayloads, sharedPayloads]
  );

  const shareSignature = useMemo(
    () => createIncomingShareSignature(normalized.items),
    [normalized.items]
  );

  const closeRoute = isAuthenticated
    ? INCOMING_SHARE_HOME_ROUTE
    : INCOMING_SHARE_AUTH_ROUTE;

  const clearAndReplace = useCallback(
    (route: Href) => {
      clearSharedPayloads();
      router.replace(route);
    },
    [clearSharedPayloads, router]
  );

  const handleClose = useCallback(() => {
    clearAndReplace(closeRoute);
  }, [clearAndReplace, closeRoute]);

  const handleOpenLogin = useCallback(() => {
    clearAndReplace(INCOMING_SHARE_AUTH_ROUTE);
  }, [clearAndReplace]);

  useEffect(() => {
    refreshSharePayloads();
  }, [refreshSharePayloads]);

  useEffect(
    () => () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    },
    []
  );

  // Auto-close the modal when there is no shared content.
  // This handles the case where the app reloads after a successful import
  // and the native intent re-routes to /incoming-share, but payloads have
  // already been cleared.
  useEffect(() => {
    if (status === "empty" && !isResolving && !isLoading) {
      clearAndReplace(closeRoute);
    }
  }, [status, isResolving, isLoading, clearAndReplace, closeRoute]);

  useEffect(() => {
    const preImportStatus = getPreImportStatus({
      isLoadingAuth: isLoading,
      isResolving,
      isAuthenticated,
      normalizedItemCount: normalized.items.length,
      hasResolveError: Boolean(shareResolveError),
    });

    if (preImportStatus === "resolving") {
      setStatus("resolving");
      return;
    }

    if (preImportStatus === "empty") {
      if (authRequiredHandledRef.current) {
        return;
      }
      setStatus("empty");
      return;
    }

    if (preImportStatus === "error") {
      setErrorDetail(
        shareResolveError?.message ?? "Failed to read shared content."
      );
      setStatus("error");
      return;
    }

    if (preImportStatus === "authRequired") {
      authRequiredHandledRef.current = true;

      if (processedSignatureRef.current !== shareSignature) {
        clearSharedPayloads();
        processedSignatureRef.current = shareSignature;
      }

      setStatus("authRequired");
      return;
    }

    authRequiredHandledRef.current = false;

    if (
      processedSignatureRef.current === shareSignature ||
      isProcessingRef.current
    ) {
      return;
    }

    let isCancelled = false;
    isProcessingRef.current = true;
    setErrorDetail(null);
    setStatus("saving");

    void (async () => {
      try {
        const importResult = await importIncomingShareItems(
          normalized.items,
          {
            createCard,
            uploadFileFromUri: uploadFromUri,
          },
          {
            isAuthenticated: true,
          }
        );

        if (isCancelled) {
          return;
        }

        processedSignatureRef.current = shareSignature;
        clearSharedPayloads();

        const postImportStatus = getPostImportStatus(importResult);
        setStatus(postImportStatus);

        if (postImportStatus === "error" && importResult.failures.length > 0) {
          setErrorDetail(importResult.failures[0]?.message ?? null);
        }

        if (postImportStatus === "saved") {
          successTimeoutRef.current = setTimeout(() => {
            router.replace(INCOMING_SHARE_HOME_ROUTE);
          }, INCOMING_SHARE_SUCCESS_REDIRECT_DELAY_MS);
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorDetail(
            getErrorMessage(error, "Shared content could not be saved.")
          );
          setStatus("error");
        }
      } finally {
        isProcessingRef.current = false;
      }
    })();

    return () => {
      isCancelled = true;
      isProcessingRef.current = false;
    };
  }, [
    clearSharedPayloads,
    createCard,
    isAuthenticated,
    isLoading,
    isResolving,
    normalized.items,
    router,
    shareResolveError,
    shareSignature,
    uploadFromUri,
  ]);

  return {
    errorDetail,
    handleClose,
    handleOpenLogin,
    status,
  };
}
