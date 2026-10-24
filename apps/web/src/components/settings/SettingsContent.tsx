"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import { ExternalLink } from "vadivam-react";
import type { LanguageSetting } from "@/hooks/useLanguageSetting";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import type { ApiKeyListItem, CreatedApiKey } from "./ApiKeysDialog";
import { CustomerPortalButton } from "./CustomerPortalButton";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import type { ExportState } from "./ExportPanel";
import {
  type ImportExportOpenRequest,
  ImportExportSection,
} from "./ImportExportSection";
import {
  type InboundEmailPanelProps,
  InboundEmailSection,
} from "./InboundEmailDialog";
import { LanguageRow } from "./LanguageRow";
import {
  type ConnectionIdentity,
  type ConnectionTarget,
  type DeviceSession,
  SecuritySection,
} from "./SecuritySection";
import { SettingRow, SettingValueSkeleton } from "./SettingRow";
import { SettingsFooter } from "./SettingsFooter";
import { ThemeToggle } from "./ThemeToggle";

const LOADED_VALUE = "fade-in-0 animate-in duration-300";
const LOADED_GROUP = `${LOADED_VALUE} flex items-center gap-2 -space-x-2.5`;
// A read-only value: plain text, padded like the row's link buttons. Long
// values (an email address) wrap instead of running under the row's title.
const SETTING_TEXT =
  "min-w-0 px-3 text-right text-muted-foreground text-sm [overflow-wrap:anywhere]";

interface SettingsContentProps {
  accountLoading: boolean;
  cardCount: number;
  connectionIdentity?: ConnectionIdentity;
  deleteDialogError: string | null;
  deleteDialogOpen: boolean;
  deleteLoading: boolean;
  email?: string | null;
  exportLoading?: boolean;
  exportState?: ExportState | null;
  hasPremium?: boolean;
  importExportRequest?: ImportExportOpenRequest | null;
  /** Save by email's state and switch; the row is left out without it. */
  inboundEmail?: InboundEmailPanelProps;
  keys: ApiKeyListItem[] | undefined;
  /** The Language row; left out where there is no locale provider. */
  language?: LanguageSetting | null;
  onCancelExport: (jobId: string) => Promise<void>;
  onCreateApiKey: () => Promise<CreatedApiKey>;
  onCreateCustomerPortal: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onDownloadExport: (jobId: string) => Promise<void>;
  onLoadMoreSessions: () => void;
  onRetrySessions?: () => void;
  onRevokeAllApiKeys: () => Promise<{ hasMore: boolean; revokedCount: number }>;
  onRevokeApiKey: (keyId: string) => Promise<void>;
  onRevokeOAuthConnection: (target: ConnectionTarget) => Promise<void>;
  onRevokeSession: (sessionId: string, current: boolean) => Promise<void>;
  onRotateApiKey: (keyId: string) => Promise<CreatedApiKey>;
  onSignOut: () => Promise<void> | void;
  onStartExport: () => Promise<void>;
  onThemeChange?: (value: string) => void;
  onUpgrade: () => void;
  sessions: DeviceSession[] | undefined;
  sessionsError?: string | null;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
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
  accountLoading,
  importExportRequest,
  inboundEmail,
  keys,
  connectionIdentity,
  sessions,
  sessionsError,
  onRetrySessions,
  sessionsHasMore,
  sessionsLoadingMore,
  onLoadMoreSessions,
  onRevokeSession,
  onCancelExport,
  onCreateApiKey,
  onCreateCustomerPortal,
  onDeleteAccount,
  onDeleteDialogOpenChange,
  onDownloadExport,
  onRevokeAllApiKeys,
  onRevokeApiKey,
  onRevokeOAuthConnection,
  onRotateApiKey,
  onSignOut,
  onStartExport,
  onThemeChange,
  language,
  onUpgrade,
  signOutLoading,
  subscriptionDialog,
}: SettingsContentProps) {
  const t = useTranslations("settings.content");
  const tRows = useTranslations("settings.rows");
  const planRowContent = hasPremium ? (
    <span className={LOADED_GROUP}>
      <Badge>{t("pro")}</Badge>
      <CustomerPortalButton
        aria-label={t("manageSubscription")}
        className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
        onCreatePortal={onCreateCustomerPortal}
      >
        {t("manage")}
        <ExternalLink className="size-4" />
      </CustomerPortalButton>
    </span>
  ) : (
    <span className={LOADED_GROUP}>
      <Badge variant="outline">{t("freePlan")}</Badge>
      <Button onClick={onUpgrade} size="sm" variant="link">
        {t("upgrade")}
      </Button>
    </span>
  );

  return (
    <>
      <SettingRow title={tRows("email")}>
        {accountLoading ? (
          <SettingValueSkeleton className="w-44" />
        ) : (
          <span className={`${LOADED_VALUE} ${SETTING_TEXT}`}>
            {email ?? t("notAvailable")}
          </span>
        )}
      </SettingRow>

      <SettingRow title={tRows("usage")}>
        {accountLoading ? (
          <SettingValueSkeleton className="w-16" />
        ) : (
          <span className={`${LOADED_VALUE} ${SETTING_TEXT}`}>
            {t("cardCount", { count: cardCount })}
          </span>
        )}
      </SettingRow>

      <SettingRow title={tRows("plan")}>
        {accountLoading ? (
          <SettingValueSkeleton className="w-28" />
        ) : (
          planRowContent
        )}
      </SettingRow>

      {inboundEmail ? <InboundEmailSection {...inboundEmail} /> : null}

      <SecuritySection
        apiKeys={{
          isLoading: keys === undefined,
          keys,
          onCreateKey: onCreateApiKey,
          onRevokeAllKeys: onRevokeAllApiKeys,
          onRevokeKey: onRevokeApiKey,
          onRotateKey: onRotateApiKey,
        }}
        connectionIdentity={connectionIdentity}
        onLoadMoreSessions={onLoadMoreSessions}
        onRetrySessions={onRetrySessions}
        onRevokeConnection={onRevokeOAuthConnection}
        onRevokeSession={onRevokeSession}
        sessions={sessions}
        sessionsError={sessionsError}
        sessionsHasMore={sessionsHasMore}
        sessionsLoadingMore={sessionsLoadingMore}
      />

      <ImportExportSection
        exportLoading={exportLoading ?? exportState === undefined}
        exportState={exportState}
        onCancelExport={onCancelExport}
        onDownloadExport={onDownloadExport}
        onStartExport={onStartExport}
        openRequest={importExportRequest}
      />

      <SettingRow title={tRows("theme")}>
        <ThemeToggle onThemeChange={onThemeChange} />
      </SettingRow>

      {language ? (
        <SettingRow title={tRows("language")}>
          <LanguageRow {...language} />
        </SettingRow>
      ) : null}

      <SettingRow title={tRows("signOut")}>
        <Button
          disabled={signOutLoading}
          onClick={() => {
            void onSignOut();
          }}
          size="sm"
          variant="link"
        >
          {signOutLoading ? <Spinner /> : t("signOut")}
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
