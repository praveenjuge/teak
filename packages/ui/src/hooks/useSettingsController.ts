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
  onOpenExternal: (url: string) => Promise<unknown> | unknown;
  onSignOut: () => Promise<void> | void;
}

export function useSettingsController({
  onCaptureError,
  onDeleteAccount,
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
    handleCreateApiKey,
    handleCreateCustomerPortal,
    handleDeleteAccount,
    handleRevokeApiKey,
    handleRotateApiKey,
    handleSignOut,
    hasPremium: user?.hasPremium,
    isLoading: user === undefined,
    keys,
    setDeleteDialogOpen,
    setDeleteError,
    signOutLoading,
  };
}

export type { UseSettingsControllerOptions };
