import { useSettingsController } from "@teak/ui/hooks";
import { SettingsShell } from "@teak/ui/screens";
import { SettingsContent } from "@teak/ui/settings";
import { logoutNativeSession } from "@/lib/native-auth";
import { buildWebUrl } from "@/lib/desktop-config";

interface SettingsPageProps {
  onNavigateBack: () => void;
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

  const handleUpgradeClick = async () => {
    const upgradeUrl = buildWebUrl("/settings");
    await window.teakDesktop.shell.openExternal(upgradeUrl);
  };

  return (
    <SettingsShell
      backControl={
        <button
          className="inline-block font-medium text-primary hover:underline"
          onClick={onNavigateBack}
          type="button"
        >
          &larr; Back
        </button>
      }
      sectionClassName="relative px-4"
      withMain={true}
    >
      <SettingsContent
        cardCount={settings.cardCount}
        deleteDialogError={settings.deleteDialogError}
        deleteDialogOpen={settings.deleteDialogOpen}
        deleteLoading={settings.deleteLoading}
        email={settings.email}
        hasPremium={settings.hasPremium}
        isLoading={settings.isLoading}
        keys={settings.keys}
        onCreateApiKey={settings.handleCreateApiKey}
        onCreateCustomerPortal={settings.handleCreateCustomerPortal}
        onDeleteAccount={settings.handleDeleteAccount}
        onDeleteDialogOpenChange={settings.setDeleteDialogOpen}
        onSignOut={settings.handleSignOut}
        onUpgrade={() => {
          void handleUpgradeClick();
        }}
        signOutLoading={settings.signOutLoading}
      />
    </SettingsShell>
  );
}
