"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { captureEvent } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { normalizeErrorClass } from "@teak/convex/shared/telemetry";
import { useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TOAST_IDS } from "../constants/toast";
import { useQuery } from "../lib/convexQueryHooks";
import { openCustomerPortal } from "../lib/customerPortal";
import type { ConnectionTarget } from "../lib/securitySessions";
import { ALL_SETTINGS_DATA, type SettingsData } from "../lib/settingsSections";
import { useDeviceSessions } from "./useDeviceSessions";
import { useServerErrors } from "./useServerErrors";

interface UseSettingsControllerOptions {
  /** What to load beyond the account. Everything when left out. */
  load?: SettingsData;
  onDeleteAccount: () => Promise<void>;
  /** `window.open` after an await is rejected by the popup blocker. */
  onDownloadFile?: (url: string) => Promise<unknown> | unknown;
  onOpenExternal: (url: string) => Promise<unknown> | unknown;
  onSignOut: () => Promise<void> | void;
}

export function useSettingsController({
  load = ALL_SETTINGS_DATA,
  onDeleteAccount,
  onDownloadFile,
  onOpenExternal,
  onSignOut,
}: UseSettingsControllerOptions) {
  const t = useTranslations("hooks.settings");
  const errors = useServerErrors();
  const user = useQuery(api.auth.getCurrentUser);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const createCustomerPortal = useAction(api.billing.createCustomerPortal);
  const keys = useQuery(
    api.apiKeys.listUserApiKeys,
    load.apiKeys ? {} : "skip"
  );
  const createKey = useMutation(api.apiKeys.createUserApiKey);
  const revokeKey = useMutation(api.apiKeys.revokeUserApiKey);
  const rotateKey = useMutation(api.apiKeys.rotateUserApiKey);
  const revokeAllKeys = useMutation(api.apiKeys.revokeAllUserApiKeys);
  const connectionUserId = user?._id;
  const devices = useDeviceSessions(
    load.sessions ? connectionUserId : undefined
  );
  const revokeAuthkitSession = useAction(
    api.securitySessions.revokeAuthkitSession
  );
  const revokeOtherAuthkitSessions = useAction(
    api.securitySessions.revokeOtherAuthkitSessions
  );
  // Never signs out this device: the server skips the calling session.
  const handleRevokeOtherSessions = async () => {
    const result = await revokeOtherAuthkitSessions({});
    if (devices.isCurrentIdentity()) {
      await devices.refreshSessions();
    }
    return result;
  };
  const handleRevokeSession = async (sessionId: string, current: boolean) => {
    await revokeAuthkitSession({ sessionId });
    if (!devices.isCurrentIdentity()) {
      return;
    }
    if (current) {
      await onSignOut();
    } else {
      await devices.refreshSessions();
    }
  };
  const connectionIdentity = useMemo(
    () =>
      connectionUserId
        ? { key: connectionUserId, cacheKey: crypto.randomUUID() }
        : undefined,
    [connectionUserId]
  );
  const activeConnectionIdentity = useRef(connectionIdentity?.cacheKey);
  activeConnectionIdentity.current = connectionIdentity?.cacheKey;
  const disconnectConsent = useAction(api.workosConsents.disconnectConnection);

  const exportState = useQuery(
    api.dataExport.getLatestExport,
    load.exportState ? {} : "skip"
  );
  const startExportMutation = useMutation(api.dataExport.startExport);
  const cancelExportMutation = useMutation(api.dataExport.cancelExport);
  const getExportDownloadUrl = useAction(api.dataExport.getExportDownloadUrl);

  const handleStartExport = async () => {
    captureEvent("export_started");
    try {
      const result = await startExportMutation({});
      if (!result.started && result.reason === "quota_exceeded") {
        throw new Error("Weekly export limit reached.");
      }
      if (!result.started && result.reason === "already_active") {
        throw new Error("An export is already in progress.");
      }
    } catch (error) {
      captureEvent("export_failed", {
        error_class: normalizeErrorClass(error),
      });
      captureClientException(error, { operation: "export.start" });
      throw error;
    }
  };

  const handleCancelExport = async (jobId: Id<"exportJobs">) => {
    await cancelExportMutation({ jobId });
  };

  const handleDownloadExport = async (jobId: Id<"exportJobs">) => {
    const result = await getExportDownloadUrl({ jobId });
    if (!result?.url) {
      throw new Error("Download is not available.");
    }
    captureEvent("export_completed");
    await (onDownloadFile ?? onOpenExternal)(result.url);
  };

  const handleCreateApiKey = (name?: string) =>
    createKey({ name: name?.trim() || "Default API key" });

  const handleRevokeApiKey = async (keyId: string) => {
    await revokeKey({ keyId });
  };

  const handleRevokeAllApiKeys = () => revokeAllKeys({});

  const handleRotateApiKey = (keyId: string) => rotateKey({ keyId });

  const handleRevokeOAuthConnection = async (target: ConnectionTarget) => {
    if (
      !connectionIdentity ||
      connectionIdentity.cacheKey !== activeConnectionIdentity.current
    ) {
      throw new Error("This account changed. Please try again.");
    }
    await disconnectConsent({ consentId: target.consentId });
  };

  const handleCreateCustomerPortal = async () => {
    const toastId = toast.loading(t("openingPortal"), {
      id: TOAST_IDS.customerPortal,
    });

    try {
      await openCustomerPortal({
        createCustomerPortal: () => createCustomerPortal({}),
        openPortal: onOpenExternal,
      });
      toast.success(t("portalOpened"), { id: toastId });
    } catch (error) {
      captureClientException(error, {
        operation: "billing.customer_portal",
      });
      toast.error(t("portalFailed"), { id: toastId });
    }
  };

  // A new attempt starts without the last one's error.
  const openDeleteDialog = (open: boolean) => {
    if (open) {
      setDeleteError(null);
    }
    setDeleteDialogOpen(open);
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      await onDeleteAccount();
      setDeleteDialogOpen(false);
    } catch (error) {
      captureClientException(error, { operation: "account.delete" });
      setDeleteError(errors.message(error, t("deleteAccountFailed")));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSignOut = async () => {
    setSignOutLoading(true);
    try {
      await onSignOut();
    } catch (error) {
      captureClientException(error, { operation: "auth.sign_out" });
      toast.error(t("signOutFailed"));
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
    name: user?.name,
    exportState,
    handleCancelExport,
    handleCreateApiKey,
    handleCreateCustomerPortal,
    handleDeleteAccount,
    handleDownloadExport,
    handleRevokeAllApiKeys,
    handleRevokeApiKey,
    handleRevokeOAuthConnection,
    handleRotateApiKey,
    handleSignOut,
    handleStartExport,
    hasPremium: user?.hasPremium,
    accountLoading: user === undefined,
    keys,
    connectionIdentity,
    ...devices,
    handleRevokeOtherSessions,
    handleRevokeSession,
    setDeleteDialogOpen: openDeleteDialog,
    setDeleteError,
    signOutLoading,
  };
}

export type { UseSettingsControllerOptions };
