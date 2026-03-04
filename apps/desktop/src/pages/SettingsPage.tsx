import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { exit } from "@tauri-apps/plugin-process";
import { api } from "@teak/convex";
import { Badge } from "@teak/ui/components/ui/badge";
import { Button } from "@teak/ui/components/ui/button";
import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { TopPattern } from "@teak/ui/patterns";
import {
  ApiKeysSection,
  CustomerPortalButton,
  DeleteAccountDialog,
  SettingRow,
  SettingsFooter,
  ThemeToggle,
} from "@teak/ui/settings";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { ExternalLink } from "lucide-react";
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

  // API Keys
  const keys = useQuery(convexApi.apiKeys.listUserApiKeys, {}) as
    | { id: string }[]
    | undefined;
  const createKey = useMutation(convexApi.apiKeys.createUserApiKey);

  // Keyboard shortcuts
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
      // Open account deletion in browser
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

  if (isLoading) {
    return <PageLoadingState />;
  }

  return (
    <main className="min-h-screen">
      <section className="relative mx-auto my-10 w-full max-w-md space-y-5 px-4">
        <button
          className="inline-block font-medium text-primary hover:underline"
          onClick={() => navigate("/")}
          type="button"
        >
          &larr; Back
        </button>
        <div className="space-y-5 rounded-lg border bg-background p-7">
          <h1 className="font-semibold text-xl tracking-tight">Settings</h1>

          <SettingRow title="Email">
            <Button disabled size="sm" variant="ghost">
              {user?.email ?? "Not available"}
            </Button>
          </SettingRow>

          <SettingRow title="Usage">
            <Button disabled size="sm" variant="ghost">
              {`${cardCount} Cards`}
            </Button>
          </SettingRow>

          <SettingRow title="Plan">
            {hasPremium ? (
              <>
                <Badge>Pro</Badge>
                <CustomerPortalButton
                  className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
                  onCreatePortal={handleCreateCustomerPortal}
                >
                  Manage
                  <ExternalLink className="size-4" />
                </CustomerPortalButton>
              </>
            ) : (
              <>
                <Badge variant="outline">Free Plan</Badge>
                <Button onClick={handleUpgradeClick} size="sm" variant="link">
                  Upgrade
                  <ExternalLink className="ml-1 size-4" />
                </Button>
              </>
            )}
          </SettingRow>

          <ApiKeysSection
            isLoading={keys === undefined}
            keys={keys}
            onCreateKey={handleCreateApiKey}
          />

          <SettingRow title="Theme">
            <ThemeToggle />
          </SettingRow>

          <SettingRow title="Sign out">
            <Button
              disabled={signOutLoading}
              onClick={handleSignOut}
              size="sm"
              variant="link"
            >
              {signOutLoading ? <Spinner /> : "Sign out"}
            </Button>
          </SettingRow>

          <SettingsFooter onDeleteClick={() => setDeleteDialogOpen(true)} />
        </div>
        <TopPattern />
      </section>

      <DeleteAccountDialog
        error={deleteError}
        loading={deleteLoading}
        onDelete={handleDeleteAccount}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
      />
    </main>
  );
}
