import { useConvexAuth } from "convex/react";
import { type Href, useRouter } from "expo-router";
import { useIncomingShare } from "expo-sharing";
import { usePostHog } from "posthog-react-native";
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
import type {
  IncomingShareStatus,
  NormalizedShareItem,
} from "@/lib/share/types";

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
  const posthog = usePostHog();
  const createCard = useCreateCard();
  const { uploadFromUri } = useUploadFromUri();
  const [status, setStatus] = useState<IncomingShareStatus>("resolving");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const processedSignatureRef = useRef("");
  const authRequiredHandledRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isMountedRef = useRef(true);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSharedPayloadsRef = useRef<() => void>(() => {});
  const createCardRef = useRef(createCard);
  const normalizedItemsRef = useRef<NormalizedShareItem[]>([]);
  const uploadFromUriRef = useRef(uploadFromUri);
  const routerRef = useRef(router);

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
  const normalizedItemCount = normalized.items.length;
  const shareResolveErrorMessage = shareResolveError?.message ?? null;

  const shareSignature = useMemo(
    () => createIncomingShareSignature(normalized.items),
    [normalized.items]
  );

  const closeRoute = isAuthenticated
    ? INCOMING_SHARE_HOME_ROUTE
    : INCOMING_SHARE_AUTH_ROUTE;

  useEffect(() => {
    clearSharedPayloadsRef.current = clearSharedPayloads;
  }, [clearSharedPayloads]);

  useEffect(() => {
    createCardRef.current = createCard;
  }, [createCard]);

  useEffect(() => {
    normalizedItemsRef.current = normalized.items;
  }, [normalized.items]);

  useEffect(() => {
    uploadFromUriRef.current = uploadFromUri;
  }, [uploadFromUri]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const clearAndCloseTo = useCallback((route: Href) => {
    clearSharedPayloadsRef.current();

    if (routerRef.current.canDismiss()) {
      routerRef.current.dismissTo(route);
      return;
    }

    routerRef.current.replace(route);
  }, []);

  const handleClose = useCallback(() => {
    clearAndCloseTo(closeRoute);
  }, [clearAndCloseTo, closeRoute]);

  const handleOpenLogin = useCallback(() => {
    clearAndCloseTo(INCOMING_SHARE_AUTH_ROUTE);
  }, [clearAndCloseTo]);

  useEffect(() => {
    refreshSharePayloads();
  }, [refreshSharePayloads]);

  useEffect(
    () => () => {
      isMountedRef.current = false;

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
      clearAndCloseTo(closeRoute);
    }
  }, [status, isResolving, isLoading, clearAndCloseTo, closeRoute]);

  useEffect(() => {
    const preImportStatus = getPreImportStatus({
      isLoadingAuth: isLoading,
      isResolving,
      isAuthenticated,
      normalizedItemCount,
      hasResolveError: shareResolveErrorMessage !== null,
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
        shareResolveErrorMessage ?? "Failed to read shared content."
      );
      setStatus("error");
      return;
    }

    if (preImportStatus === "authRequired") {
      authRequiredHandledRef.current = true;

      if (processedSignatureRef.current !== shareSignature) {
        clearSharedPayloadsRef.current();
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

    isProcessingRef.current = true;
    setErrorDetail(null);
    setStatus("saving");

    void (async () => {
      try {
        const importResult = await importIncomingShareItems(
          normalizedItemsRef.current,
          {
            createCard: createCardRef.current,
            uploadFileFromUri: uploadFromUriRef.current,
          },
          {
            isAuthenticated: true,
          }
        );

        if (!isMountedRef.current) {
          return;
        }

        processedSignatureRef.current = shareSignature;
        clearSharedPayloadsRef.current();

        const postImportStatus = getPostImportStatus(importResult);
        setStatus(postImportStatus);

        if (postImportStatus === "error" && importResult.failures.length > 0) {
          setErrorDetail(importResult.failures[0]?.message ?? null);
          posthog.capture("incoming_share_failed", {
            error_detail: importResult.failures[0]?.message ?? null,
            item_count: normalizedItemsRef.current.length,
          });
        }

        if (postImportStatus === "saved") {
          posthog.capture("incoming_share_saved", {
            item_count: normalizedItemsRef.current.length,
          });
          if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current);
          }
          successTimeoutRef.current = setTimeout(() => {
            clearAndCloseTo(INCOMING_SHARE_HOME_ROUTE);
          }, INCOMING_SHARE_SUCCESS_REDIRECT_DELAY_MS);
        }
      } catch (error) {
        if (isMountedRef.current) {
          const errorMessage = getErrorMessage(
            error,
            "Shared content could not be saved."
          );
          setErrorDetail(errorMessage);
          setStatus("error");
          posthog.capture("incoming_share_failed", {
            error_detail: errorMessage,
          });
        }
      } finally {
        isProcessingRef.current = false;
      }
    })();
  }, [
    clearAndCloseTo,
    isAuthenticated,
    isLoading,
    isResolving,
    normalizedItemCount,
    posthog,
    shareResolveErrorMessage,
    shareSignature,
  ]);

  return {
    errorDetail,
    handleClose,
    handleOpenLogin,
    status,
  };
}
