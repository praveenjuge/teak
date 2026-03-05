import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { exit } from "@tauri-apps/plugin-process";
import { api } from "@teak/convex";
import { useQuery } from "@teak/ui/convex-query-hooks";
import { SettingsShell } from "@teak/ui/screens";
import { SettingsContent } from "@teak/ui/settings";
import { useAction, useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { logoutDesktopSession } from "@/lib/desktop-auth";
import { buildWebUrl } from "@/lib/web-urls";

const convexApi = api as any;

export function SettingsPage() {
  const navigate = useNavigate();
  const user = useQuery(api.auth.getCurrentUser);
  const cardCount = user?.cardCount ?? 0;
  const hasPremium = user?.hasPremium;
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const createCustomerPortal = useAction(api.billing.createCustomerPortal);

  const keys = useQuery(convexApi.apiKeys.listUserApiKeys, {}) as
    | { id: string }[]
    | undefined;
  const createKey = useMutation(convexApi.apiKeys.createUserApiKey);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl && e.key === "w") {
        e.preventDefault();
        void getCurrentWindow().close();
      } else if (isCmdOrCtrl && e.key === "q") {
        e.preventDefault();
        void exit(0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isLoading = user === undefined;

  const handleCreateCustomerPortal = async () => {
    const toastId = toast.loading("Opening customer portal...");
    try {
      const portalUrl = await createCustomerPortal({});
      await openUrl(portalUrl);
      toast.success("Customer portal opened", { id: toastId });
    } catch (error) {
      console.error("Failed to open customer portal", error);
      toast.error("Could not open portal", { id: toastId });
    }
  };

  const handleSignOut = useCallback(async () => {
    setSignOutLoading(true);
    try {
      await logoutDesktopSession();
    } catch {
      toast.error("Failed to sign out. Please try again.");
    } finally {
      setSignOutLoading(false);
    }
  }, []);

  const handleCreateApiKey = async () => {
    return (await createKey({ name: "API Keys" })) as { key: string };
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const deleteUrl = buildWebUrl("/settings");
      await openUrl(deleteUrl);
      setDeleteDialogOpen(false);
    } catch {
      setDeleteError("Failed to open account deletion page.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleUpgradeClick = async () => {
    const upgradeUrl = buildWebUrl("/settings");
    await openUrl(upgradeUrl);
  };

  return (
    <SettingsShell
      backControl={
        <button
          className="inline-block font-medium text-primary hover:underline"
          onClick={() => navigate("/")}
          type="button"
        >
          &larr; Back
        </button>
      }
      sectionClassName="relative px-4"
      withMain={true}
    >
      <SettingsContent
        cardCount={cardCount}
        deleteDialogError={deleteError}
        deleteDialogOpen={deleteDialogOpen}
        deleteLoading={deleteLoading}
        email={user?.email}
        hasPremium={hasPremium}
        isLoading={isLoading}
        keys={keys}
        onCreateApiKey={handleCreateApiKey}
        onCreateCustomerPortal={handleCreateCustomerPortal}
        onDeleteAccount={handleDeleteAccount}
        onDeleteDialogOpenChange={setDeleteDialogOpen}
        onSignOut={handleSignOut}
        onUpgrade={() => {
          void handleUpgradeClick();
        }}
        signOutLoading={signOutLoading}
      />
    </SettingsShell>
  );
}
