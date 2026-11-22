import { useNavigate } from "@tanstack/react-router";
import { SETTINGS_PATHS } from "@teak/convex/shared/webRoutes";
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
import { useSettings } from "@/components/settings/SettingsProvider";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";

export function SettingsPage() {
  const { inboundEmail, language, settings } = useSettings();
  const billingEnabled = useBillingEnabled();
  return (
    <SettingsOverview
      accountLoading={settings.accountLoading}
      apiKeyCount={settings.keys?.length}
      billingEnabled={billingEnabled}
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

export function PlanPage() {
  const { checkout, settings } = useSettings();
  const billingEnabled = useBillingEnabled();
  const navigate = useNavigate();
  useEffect(() => {
    if (!billingEnabled) {
      navigate({ href: SETTINGS_PATHS.account, replace: true });
    }
  }, [billingEnabled, navigate]);
  if (!billingEnabled) {
    return null;
  }
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

export function AppearancePage() {
  const { language } = useSettings();
  return <AppearanceSettings language={language} />;
}

export function IntegrationsPage() {
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

export function SecurityPage() {
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

export function DataPage() {
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
