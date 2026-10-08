import { useSettingsController } from "@teak/ui/hooks";
import { SettingsShell } from "@teak/ui/screens";
import { SettingsContent } from "@teak/ui/settings";
import { buildWebUrl } from "@/lib/desktop-config";

interface SettingsPageProps {
  onNavigateBack: () => void;
}

async function handleUpgradeClick() {
  const upgradeUrl = buildWebUrl("/settings");
  await window.teakDesktop.shell.openExternal(upgradeUrl);
}

export function SettingsPage({ onNavigateBack }: SettingsPageProps) {
  const settings = useSettingsController({
    onDeleteAccount: async () => {
      try {
        await window.teakDesktop.shell.openExternal(buildWebUrl("/settings"));
      } catch {
        throw new Error("Failed to open account deletion page.");
      }
    },
    onOpenExternal: (url) => window.teakDesktop.shell.openExternal(url),
    // Unreachable until desktop has WorkOS sign-in; there is no session to end.
    onSignOut: () =>
      Promise.reject(new Error("Sign-in isn't available in this build yet.")),
  });

  return (
    <SettingsShell
      onBack={onNavigateBack}
      sectionClassName="relative px-4"
      withMain={true}
    >
      <SettingsContent
        accountLoading={settings.accountLoading}
        cardCount={settings.cardCount}
        connectionIdentity={settings.connectionIdentity}
        deleteDialogError={settings.deleteDialogError}
        deleteDialogOpen={settings.deleteDialogOpen}
        deleteLoading={settings.deleteLoading}
        email={settings.email}
        exportState={settings.exportState}
        hasPremium={settings.hasPremium}
        keys={settings.keys}
        onCancelExport={settings.handleCancelExport}
        onCreateApiKey={settings.handleCreateApiKey}
        onCreateCustomerPortal={settings.handleCreateCustomerPortal}
        onDeleteAccount={settings.handleDeleteAccount}
        onDeleteDialogOpenChange={settings.setDeleteDialogOpen}
        onDownloadExport={settings.handleDownloadExport}
        onLoadMoreSessions={settings.loadMoreSessions}
        onRetrySessions={settings.retrySessions}
        onRevokeAllApiKeys={settings.handleRevokeAllApiKeys}
        onRevokeApiKey={settings.handleRevokeApiKey}
        onRevokeOAuthConnection={settings.handleRevokeOAuthConnection}
        onRevokeSession={settings.handleRevokeSession}
        onRotateApiKey={settings.handleRotateApiKey}
        onSignOut={settings.handleSignOut}
        onStartExport={settings.handleStartExport}
        onUpgrade={() => {
          void handleUpgradeClick();
        }}
        sessions={settings.sessions}
        sessionsError={settings.sessionsError}
        sessionsHasMore={settings.sessionsHasMore}
        sessionsLoadingMore={settings.sessionsLoadingMore}
        signOutLoading={settings.signOutLoading}
      />
    </SettingsShell>
  );
}
