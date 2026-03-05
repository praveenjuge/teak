"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { ApiKeysSection } from "./ApiKeysSection";
import { CustomerPortalButton } from "./CustomerPortalButton";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { SettingRow } from "./SettingRow";
import { SettingsFooter } from "./SettingsFooter";
import { ThemeToggle } from "./ThemeToggle";

interface SettingsContentProps {
  cardCount: number;
  deleteDialogError: string | null;
  deleteDialogOpen: boolean;
  deleteLoading: boolean;
  email?: string | null;
  hasPremium?: boolean;
  isLoading: boolean;
  keys: { id: string }[] | undefined;
  onCreateApiKey: () => Promise<{ key: string }>;
  onCreateCustomerPortal: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onSignOut: () => Promise<void> | void;
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
  hasPremium,
  isLoading,
  keys,
  onCreateApiKey,
  onCreateCustomerPortal,
  onDeleteAccount,
  onDeleteDialogOpenChange,
  onSignOut,
  onThemeChange,
  onUpgrade,
  signOutLoading,
  subscriptionDialog,
}: SettingsContentProps) {
  return (
    <>
      <h1 className="font-semibold text-xl tracking-tight">Settings</h1>

      <SettingRow title="Email">
        <Button disabled size="sm" variant="ghost">
          {isLoading ? <Spinner /> : (email ?? "Not available")}
        </Button>
      </SettingRow>

      <SettingRow title="Usage">
        <Button disabled size="sm" variant="ghost">
          {isLoading ? <Spinner /> : `${cardCount} Cards`}
        </Button>
      </SettingRow>

      <SettingRow title="Plan">
        {isLoading ? (
          <Button disabled size="sm" variant="ghost">
            <Spinner />
          </Button>
        ) : hasPremium ? (
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
        )}
      </SettingRow>

      <ApiKeysSection
        isLoading={keys === undefined}
        keys={keys}
        onCreateKey={onCreateApiKey}
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
