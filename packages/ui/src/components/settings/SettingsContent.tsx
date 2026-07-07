"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import type { ApiKeyListItem } from "./ApiKeysDialog";
import { ApiKeysSection } from "./ApiKeysSection";
import { shouldShowApiKeysSection } from "./apiKeysGating";
import { CustomerPortalButton } from "./CustomerPortalButton";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import type { ExportState } from "./ExportPanel";
import { ImportExportSection } from "./ImportExportSection";
import { SettingRow } from "./SettingRow";
import { SettingsFooter } from "./SettingsFooter";
import { ThemeToggle } from "./ThemeToggle";

interface SettingsContentProps {
  cardCount: number;
  deleteDialogError: string | null;
  deleteDialogOpen: boolean;
  deleteLoading: boolean;
  email?: string | null;
  exportLoading?: boolean;
  exportState?: ExportState | null;
  hasPremium?: boolean;
  isLoading: boolean;
  keys: ApiKeyListItem[] | undefined;
  onCancelExport: (jobId: string) => Promise<void>;
  onCreateApiKey: () => Promise<{ key: string }>;
  onCreateCustomerPortal: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onDownloadExport: (jobId: string) => Promise<void>;
  onRevokeApiKey: (keyId: string) => Promise<void>;
  onRotateApiKey: (keyId: string) => Promise<{ key: string }>;
  onSignOut: () => Promise<void> | void;
  onStartExport: () => Promise<void>;
  onThemeChange?: (value: string) => void;
  onUpgrade: () => void;
  signOutLoading: boolean;
  subscriptionDialog?: ReactNode;
}

export function SettingsContent({
  cardCount,
  deleteDialogError,
  deleteDialogOpen,
  deleteLoading,
  email,
  exportState,
  exportLoading,
  hasPremium,
  isLoading,
  keys,
  onCancelExport,
  onCreateApiKey,
  onCreateCustomerPortal,
  onDeleteAccount,
  onDeleteDialogOpenChange,
  onDownloadExport,
  onRevokeApiKey,
  onRotateApiKey,
  onSignOut,
  onStartExport,
  onThemeChange,
  onUpgrade,
  signOutLoading,
  subscriptionDialog,
}: SettingsContentProps) {
  const planRowContent = hasPremium ? (
    <>
      <Badge>Pro</Badge>
      <CustomerPortalButton
        className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
        onCreatePortal={onCreateCustomerPortal}
      >
        Manage
        <ExternalLink className="size-4" />
      </CustomerPortalButton>
    </>
  ) : (
    <>
      <Badge variant="outline">Free Plan</Badge>
      <Button onClick={onUpgrade} size="sm" variant="link">
        Upgrade
      </Button>
    </>
  );

  if (isLoading) {
    return (
      <>
        <h1 className="font-semibold text-xl tracking-tight">Settings</h1>
        <div
          aria-label="Loading settings"
          className="flex min-h-64 items-center justify-center"
          role="status"
        >
          <Spinner className="size-5" />
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="font-semibold text-xl tracking-tight">Settings</h1>

      <SettingRow title="Email">
        <Button disabled size="sm" variant="ghost">
          {email ?? "Not available"}
        </Button>
      </SettingRow>

      <SettingRow title="Usage">
        <Button disabled size="sm" variant="ghost">
          {`${cardCount} Cards`}
        </Button>
      </SettingRow>

      <SettingRow title="Plan">
        {planRowContent}
      </SettingRow>

      {/* Show the API Keys section once keys have loaded, even for keyless
          users, so they can create their first key. API keys remain a
          supported alternative to browser sign-in. */}
      {shouldShowApiKeysSection(keys) ? (
        <ApiKeysSection
          isLoading={keys === undefined}
          keys={keys}
          onCreateKey={onCreateApiKey}
          onRevokeKey={onRevokeApiKey}
          onRotateKey={onRotateApiKey}
        />
      ) : null}

      {/* Import is always available; the Export tab uses these handlers, which
          both web and desktop supply, so the section is not gated on them. */}
      <ImportExportSection
        exportLoading={exportLoading ?? exportState === undefined}
        exportState={exportState}
        onCancelExport={onCancelExport}
        onDownloadExport={onDownloadExport}
        onStartExport={onStartExport}
      />

      <SettingRow title="Theme">
        <ThemeToggle onThemeChange={onThemeChange} />
      </SettingRow>

      <SettingRow title="Sign out">
        <Button
          disabled={signOutLoading}
          onClick={() => {
            void onSignOut();
          }}
          size="sm"
          variant="link"
        >
          {signOutLoading ? <Spinner /> : "Sign out"}
        </Button>
      </SettingRow>

      <SettingsFooter onDeleteClick={() => onDeleteDialogOpenChange(true)} />

      {subscriptionDialog}

      <DeleteAccountDialog
        error={deleteDialogError}
        loading={deleteLoading}
        onDelete={onDeleteAccount}
        onOpenChange={onDeleteDialogOpenChange}
        open={deleteDialogOpen}
      />
    </>
  );
}
