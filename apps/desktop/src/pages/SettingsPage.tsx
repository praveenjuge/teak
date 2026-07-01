import { useSettingsController } from "@teak/ui/hooks";
import { SettingsShell } from "@teak/ui/screens";
import { SettingsContent } from "@teak/ui/settings";
import { buildWebUrl } from "@/lib/desktop-config";
import { logoutNativeSession } from "@/lib/native-auth";

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
    onSignOut: logoutNativeSession,
  });

  return (
    <SettingsShell
      onBack={onNavigateBack}
      sectionClassName="relative px-4"
      withMain={true}
    >
      <SettingsContent
        cardCount={settings.cardCount}
        deleteDialogError={settings.deleteDialogError}
        deleteDialogOpen={settings.deleteDialogOpen}
        deleteLoading={settings.deleteLoading}
        email={settings.email}
        exportState={settings.exportState}
        hasPremium={settings.hasPremium}
        isLoading={settings.isLoading}
        keys={settings.keys}
        onCancelExport={settings.handleCancelExport}
        onCreateApiKey={settings.handleCreateApiKey}
        onCreateCustomerPortal={settings.handleCreateCustomerPortal}
        onDeleteAccount={settings.handleDeleteAccount}
        onDeleteDialogOpenChange={settings.setDeleteDialogOpen}
        onDownloadExport={settings.handleDownloadExport}
        onRevokeApiKey={settings.handleRevokeApiKey}
        onRotateApiKey={settings.handleRotateApiKey}
        onSignOut={settings.handleSignOut}
        onStartExport={settings.handleStartExport}
        onUpgrade={() => {
          void handleUpgradeClick();
        }}
        signOutLoading={settings.signOutLoading}
      />
    </SettingsShell>
  );
}
