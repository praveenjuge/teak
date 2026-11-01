"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  AppearanceSettings,
  DataSettings,
  DeleteAccountDialog,
  IntegrationsSettings,
  PlanSettings,
  SecuritySettings,
  SettingsOverview,
} from "@/components/settings";
import {
  parseSettingsDialogParam,
  settingsDataHref,
} from "@/lib/commandPalette";
import { useSettings } from "./SettingsProvider";

function useLegacyDialogRedirect() {
  const router = useRouter();
  const dialogParam = useSearchParams().get("dialog");
  useEffect(() => {
    if (dialogParam === null) {
      return;
    }
    const tab = parseSettingsDialogParam(dialogParam);
    if (tab) {
      // Let the router scroll to the section the link named.
      router.replace(settingsDataHref(tab));
    } else {
      router.replace("/settings", { scroll: false });
    }
  }, [dialogParam, router]);
}

export function SettingsPageClient() {
  useLegacyDialogRedirect();
  const { inboundEmail, language, settings } = useSettings();
  return (
    <SettingsOverview
      accountLoading={settings.accountLoading}
      apiKeyCount={settings.keys?.length}
      cardCount={settings.cardCount}
      deviceCount={settings.sessions?.length}
      devicesHaveMore={settings.sessionsHasMore}
      email={settings.email}
      exportState={settings.exportState}
      hasPremium={settings.hasPremium}
      inboundEmailEnabled={
        inboundEmail.state === undefined
          ? undefined
          : (inboundEmail.state?.enabled ?? null)
      }
      locale={language?.locale}
      name={settings.name}
      onSignOut={settings.handleSignOut}
      signOutLoading={settings.signOutLoading}
    />
  );
}

export function PlanPageClient() {
  const { checkout, settings } = useSettings();
  return (
    <PlanSettings
      accountLoading={settings.accountLoading}
      cardCount={settings.cardCount}
      checkout={checkout}
      hasPremium={settings.hasPremium}
      onCreateCustomerPortal={settings.handleCreateCustomerPortal}
    />
  );
}

export function AppearancePageClient() {
  const { language } = useSettings();
  return <AppearanceSettings language={language} />;
}

export function IntegrationsPageClient() {
  const { inboundEmail, settings } = useSettings();
  return (
    <IntegrationsSettings
      apiKeys={{
        isLoading: settings.keys === undefined,
        keys: settings.keys,
        onCreateKey: settings.handleCreateApiKey,
        onRevokeAllKeys: settings.handleRevokeAllApiKeys,
        onRevokeKey: settings.handleRevokeApiKey,
        onRotateKey: settings.handleRotateApiKey,
      }}
      inboundEmail={inboundEmail}
    />
  );
}

export function SecurityPageClient() {
  const { settings } = useSettings();
  return (
    <>
      <SecuritySettings
        connectionIdentity={settings.connectionIdentity}
        onDeleteClick={() => settings.setDeleteDialogOpen(true)}
        onLoadMoreSessions={settings.loadMoreSessions}
        onRetrySessions={settings.retrySessions}
        onRevokeConnection={settings.handleRevokeOAuthConnection}
        onRevokeOtherSessions={settings.handleRevokeOtherSessions}
        onRevokeSession={settings.handleRevokeSession}
        sessions={settings.sessions}
        sessionsError={settings.sessionsError}
        sessionsHasMore={settings.sessionsHasMore}
        sessionsLoadingMore={settings.sessionsLoadingMore}
      />
      <DeleteAccountDialog
        error={settings.deleteDialogError}
        loading={settings.deleteLoading}
        onDelete={settings.handleDeleteAccount}
        onOpenChange={settings.setDeleteDialogOpen}
        open={settings.deleteDialogOpen}
      />
    </>
  );
}

export function DataPageClient() {
  const { settings } = useSettings();
  return (
    <DataSettings
      exportLoading={settings.exportState === undefined}
      exportState={settings.exportState}
      onCancelExport={settings.handleCancelExport}
      onDownloadExport={settings.handleDownloadExport}
      onStartExport={settings.handleStartExport}
    />
  );
}
