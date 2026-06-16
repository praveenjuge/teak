"use client";

import { api } from "@teak/convex";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { TOAST_IDS } from "../constants/toast";
import { useQuery } from "../convexQueryHooks";
import { openCustomerPortal } from "../lib/customerPortal";

interface UseSettingsControllerOptions {
  onCaptureError?: (
    error: unknown,
    context: { action: string; source: string }
  ) => void;
  onDeleteAccount: () => Promise<void>;
  /**
   * Trigger a file download for the given URL. Optional; defaults to
   * `onOpenExternal`. Web should pass a handler that does not rely on
   * `window.open` (which the popup blocker rejects after an await).
   */
  onDownloadFile?: (url: string) => Promise<unknown> | unknown;
  onOpenExternal: (url: string) => Promise<unknown> | unknown;
  onSignOut: () => Promise<void> | void;
}

export function useSettingsController({
  onCaptureError,
  onDeleteAccount,
  onDownloadFile,
  onOpenExternal,
  onSignOut,
}: UseSettingsControllerOptions) {
  const user = useQuery(api.auth.getCurrentUser);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const createCustomerPortal = useAction(api.billing.createCustomerPortal);
  const keys = useQuery(api.apiKeys.listUserApiKeys, {}) as
    | {
        id: string;
        name: string;
        maskedKey: string;
        source: "component" | "legacy";
        status: "active" | "disabled" | "rotating" | "expired" | "exhausted";
        requiresUpdate: boolean;
        createdAt: number;
        lastUsedAt?: number;
      }[]
    | undefined;
  const createKey = useMutation(api.apiKeys.createUserApiKey);
  const revokeKey = useMutation(api.apiKeys.revokeUserApiKey);
  const rotateKey = useMutation(api.apiKeys.rotateUserApiKey);

  const exportState = useQuery(api.dataExport.getLatestExport, {}) as
    | {
        job: {
          id: string;
          status:
            | "pending"
            | "running"
            | "ready"
            | "failed"
            | "canceled"
            | "expired";
          cardCount?: number;
          filesIncluded?: number;
          filesOmitted?: number;
          artifactBytes?: number;
          failureClass?: string;
          createdAt: number;
          updatedAt: number;
          completedAt?: number;
          expiresAt?: number;
          downloadAvailable: boolean;
        } | null;
        canStartNew: boolean;
        quotaResetMs: number;
      }
    | null
    | undefined;
  const startExportMutation = useMutation(api.dataExport.startExport);
  const cancelExportMutation = useMutation(api.dataExport.cancelExport);
  const getExportDownloadUrl = useAction(api.dataExport.getExportDownloadUrl);

  const handleStartExport = async () => {
    const result = (await startExportMutation({})) as {
      started: boolean;
      reason?: "quota_exceeded" | "already_active";
      quotaResetMs?: number;
    };
    if (!result.started && result.reason === "quota_exceeded") {
      throw new Error("Weekly export limit reached.");
    }
  };

  const handleCancelExport = async (jobId: string) => {
    await cancelExportMutation({ jobId: jobId as never });
  };

  const handleDownloadExport = async (jobId: string) => {
    const result = (await getExportDownloadUrl({ jobId: jobId as never })) as {
      url: string;
      expiresInSeconds: number;
    } | null;
    if (!result?.url) {
      throw new Error("Download is not available.");
    }
    await (onDownloadFile ?? onOpenExternal)(result.url);
  };

  const handleCreateApiKey = async () => {
    return (await createKey({ name: "Default API key" })) as { key: string };
  };

  const handleRevokeApiKey = async (
    keyId: string,
    source: "component" | "legacy"
  ) => {
    await revokeKey({ keyId, source });
  };

  const handleRotateApiKey = async (keyId: string) => {
    return (await rotateKey({ keyId })) as { key: string };
  };

  const handleCreateCustomerPortal = async () => {
    const toastId = toast.loading("Opening customer portal...", {
      id: TOAST_IDS.customerPortal,
    });

    try {
      await openCustomerPortal({
        createCustomerPortal: () => createCustomerPortal({}),
        openPortal: onOpenExternal,
      });
      toast.success("Customer portal opened", { id: toastId });
    } catch (error) {
      console.error("Failed to open customer portal", error);
      onCaptureError?.(error, {
        action: "billing:createCustomerPortal",
        source: "convex",
      });
      toast.error("Could not open portal", { id: toastId });
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      await onDeleteAccount();
      setDeleteDialogOpen(false);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Something went wrong while deleting your account."
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSignOut = async () => {
    setSignOutLoading(true);
    try {
      await onSignOut();
    } catch {
      toast.error("Failed to sign out. Please try again.");
    } finally {
      setSignOutLoading(false);
    }
  };

  return {
    cardCount: user?.cardCount ?? 0,
    deleteDialogError: deleteError,
    deleteDialogOpen,
    deleteLoading,
    email: user?.email,
    exportState,
    handleCancelExport,
    handleCreateApiKey,
    handleCreateCustomerPortal,
    handleDeleteAccount,
    handleDownloadExport,
    handleRevokeApiKey,
    handleRotateApiKey,
    handleSignOut,
    handleStartExport,
    hasPremium: user?.hasPremium,
    isLoading: user === undefined,
    keys,
    setDeleteDialogOpen,
    setDeleteError,
    signOutLoading,
  };
}

export type { UseSettingsControllerOptions };
