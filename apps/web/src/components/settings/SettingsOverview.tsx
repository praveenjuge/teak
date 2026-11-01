"use client";

import { FREE_TIER_LIMIT } from "@teak/convex/shared/constants";
import { LOCALE_NAMES } from "@teak/i18n";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { LogOut } from "vadivam-react";
import { useHydrated } from "@/hooks/useHydrated";
import { useLocalDateFormat } from "@/hooks/useLocalDateFormat";
import { openKeyboardShortcuts } from "@/lib/keyboardShortcuts";
import {
  SETTINGS_PLAN_HREF,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "@/lib/settingsSections";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Spinner } from "../ui/spinner";
import type { ExportState } from "./ExportPanel";
import { UsageMeter, UsageRemaining } from "./PlanSettings";
import { SettingsFooter } from "./SettingsFooter";
import { SettingsSectionTile } from "./SettingsNav";
import {
  SettingsGroup,
  SettingsLinkRow,
  SettingsPageIntro,
  SettingsRow,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";
import { SettingValueSkeleton } from "./SettingValueSkeleton";

const EXPORT_DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

const LOADED = "fade-in-0 animate-in duration-300";

const LANGUAGE_NAMES = new Map(
  Object.entries(LOCALE_NAMES).map(([code, names]) => [code, names.native])
);

export interface SettingsOverviewProps {
  accountLoading: boolean;
  apiKeyCount?: number;
  cardCount: number;
  deviceCount?: number;
  devicesHaveMore?: boolean;
  email?: string | null;
  exportState?: ExportState | null;
  hasPremium?: boolean;
  inboundEmailEnabled?: boolean | null;
  locale?: string;
  name?: string | null;
  onSignOut: () => Promise<void> | void;
  signOutLoading: boolean;
}

/**
 * An address that wraps only before its `@`, never at a hyphen or dot inside
 * a part; a part wider than the screen ends in an ellipsis instead.
 */
export function EmailAddress({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  const parts = at > 0 ? [email.slice(0, at), email.slice(at)] : [email];
  const part =
    "inline-block max-w-full truncate whitespace-nowrap align-bottom";
  return (
    <span title={email}>
      <span className={part}>{parts[0]}</span>
      {parts[1] ? (
        <>
          <wbr />
          <span className={part}>{parts[1]}</span>
        </>
      ) : null}
    </span>
  );
}

function ProfileSection({
  accountLoading,
  email,
  name,
  onSignOut,
  signOutLoading,
}: Pick<
  SettingsOverviewProps,
  "accountLoading" | "email" | "name" | "onSignOut" | "signOutLoading"
>) {
  const t = useTranslations("settings.overview");
  const tContent = useTranslations("settings.content");
  const displayName = name?.trim() || null;
  const address = email ? (
    <EmailAddress email={email} />
  ) : (
    <span>{tContent("notAvailable")}</span>
  );
  let label: ReactNode = <SettingValueSkeleton className="mx-0 w-40" />;
  let description: ReactNode = (
    <SettingValueSkeleton className="mx-0 mt-1.5 w-56" />
  );
  if (!accountLoading) {
    label = displayName ? (
      <span className={`${LOADED} [overflow-wrap:anywhere]`}>
        {displayName}
      </span>
    ) : (
      <span className={LOADED}>{address}</span>
    );
    description = displayName ? (
      <span className={LOADED}>{address}</span>
    ) : null;
  }
  return (
    <section aria-label={t("signedInAs")} className="scroll-mt-20" id="profile">
      <SettingsGroup>
        <SettingsRow
          action={
            <Button
              disabled={signOutLoading}
              onClick={() => {
                void onSignOut();
              }}
              size="sm"
              variant="outline"
            >
              {signOutLoading ? <Spinner /> : <LogOut />}
              {tContent("signOut")}
            </Button>
          }
          description={description}
          label={label}
        />
      </SettingsGroup>
    </section>
  );
}

function SectionRow({
  id,
  summary,
}: {
  id: Exclude<SettingsSectionId, "account">;
  summary: ReactNode;
}) {
  const t = useTranslations("settings.nav");
  const section = SETTINGS_SECTIONS.find((item) => item.id === id);
  if (!section) {
    return null;
  }
  return (
    <li>
      <SettingsLinkRow
        description={
          summary ?? <SettingValueSkeleton className="mx-0 mt-1.5 w-28" />
        }
        href={section.href}
        icon={<SettingsSectionTile id={id} size="md" />}
        label={t(id)}
      />
    </li>
  );
}

const ACTIVE_EXPORT = new Set(["pending", "running"]);

function useSummaries({
  accountLoading,
  apiKeyCount,
  cardCount,
  deviceCount,
  devicesHaveMore,
  exportState,
  hasPremium,
  inboundEmailEnabled,
  locale,
}: SettingsOverviewProps) {
  const t = useTranslations("settings.overview");
  const intlLocale = useIntlLocale();
  const { theme } = useTheme();
  const hydrated = useHydrated();
  const formatDate = useLocalDateFormat(EXPORT_DATE_FORMAT);

  let plan: ReactNode = null;
  if (!accountLoading) {
    plan = hasPremium
      ? t("planPro", { count: cardCount })
      : t("planFree", {
          count: cardCount.toLocaleString(intlLocale),
          limit: FREE_TIER_LIMIT.toLocaleString(intlLocale),
        });
  }

  const language = LANGUAGE_NAMES.get(locale ?? "en") ?? LOCALE_NAMES.en.native;
  const appearance = hydrated
    ? t("appearance", { theme: theme ?? "system", language })
    : null;

  const integrations =
    inboundEmailEnabled === undefined || apiKeyCount === undefined
      ? null
      : t("integrations", {
          email: inboundEmailEnabled ? "on" : "off",
          keys: apiKeyCount,
        });

  let security: ReactNode = null;
  if (deviceCount !== undefined) {
    security = devicesHaveMore
      ? t("devicesMore", { count: deviceCount })
      : t("devices", { count: deviceCount });
  }

  let data: ReactNode = null;
  if (exportState !== undefined) {
    const job = exportState?.job;
    if (job && ACTIVE_EXPORT.has(job.status)) {
      data = t("exportRunning");
    } else if (job?.downloadAvailable) {
      data = t("exportReady");
    } else if (job?.completedAt) {
      data = formatDate
        ? t("exportLast", { date: formatDate(job.completedAt) })
        : null;
    } else {
      data = t("dataIdle");
    }
  }

  return { appearance, data, integrations, plan, security };
}

function PlanSection({
  accountLoading,
  cardCount,
  hasPremium,
}: Pick<SettingsOverviewProps, "accountLoading" | "cardCount" | "hasPremium">) {
  const t = useTranslations("settings.plan");
  const tNav = useTranslations("settings.nav");
  const tContent = useTranslations("settings.content");
  const tSubscription = useTranslations("settings.subscription");
  let plan: ReactNode = (
    <SettingsRow
      action={<SettingValueSkeleton className="mx-0 w-24" />}
      label={tNav("plan")}
    />
  );
  let usage: ReactNode = (
    <span aria-hidden className="flex items-center gap-3">
      <SettingValueSkeleton className="mx-0 h-1.5 w-24" />
      <SettingValueSkeleton className="mx-0 w-24" />
    </span>
  );
  if (!accountLoading && hasPremium) {
    plan = (
      <SettingsLinkRow
        href={SETTINGS_PLAN_HREF}
        label={tNav("plan")}
        value={<Badge className={LOADED}>{tContent("pro")}</Badge>}
      />
    );
    usage = (
      <span className={`${LOADED} text-muted-foreground text-sm`}>
        {t("unlimited", { count: cardCount })}
      </span>
    );
  } else if (!accountLoading) {
    plan = (
      <SettingsRow
        action={
          <Button asChild className={LOADED} size="sm">
            <Link href={SETTINGS_PLAN_HREF}>{tSubscription("title")}</Link>
          </Button>
        }
        label={tNav("plan")}
      />
    );
    usage = (
      <span className={LOADED}>
        <UsageMeter count={cardCount} limit={FREE_TIER_LIMIT} />
      </span>
    );
  }
  let usageDescription: ReactNode = null;
  if (accountLoading) {
    usageDescription = <SettingValueSkeleton className="mx-0 my-0.5 w-20" />;
  } else if (!hasPremium) {
    usageDescription = (
      <UsageRemaining count={cardCount} limit={FREE_TIER_LIMIT} />
    );
  }
  return (
    <section aria-labelledby="usage-title" className="scroll-mt-20" id="usage">
      <SettingsGroup>
        {plan}
        <SettingsRow
          action={usage}
          description={usageDescription}
          label={t("usageLabel")}
          labelId="usage-title"
        />
      </SettingsGroup>
    </section>
  );
}

function ShortcutsSection() {
  const t = useTranslations("modals.shortcuts");
  return (
    <div className="max-md:hidden">
      <SettingsSection
        action={
          <Button
            aria-label={t("title")}
            onClick={(event) => {
              // Safari doesn't focus a clicked button; the sheet hands focus
              // back to whatever had it when it opened.
              event.currentTarget.focus();
              openKeyboardShortcuts();
            }}
            size="sm"
            variant="ghost"
          >
            <Kbd>?</Kbd>
          </Button>
        }
        id="shortcuts"
        title={t("title")}
      />
    </div>
  );
}

export function SettingsOverview(props: SettingsOverviewProps) {
  const t = useTranslations("settings.overview");
  const tNav = useTranslations("settings.nav");
  const summaries = useSummaries(props);
  return (
    <>
      <SettingsPageIntro title={tNav("account")} />
      <SettingsStack>
        <ProfileSection {...props} />
        <PlanSection {...props} />
        {/* Wide screens list the sections beside the page (SettingsNav). */}
        <nav aria-label={t("sectionsLabel")} className="md:hidden">
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            <SectionRow id="plan" summary={summaries.plan} />
            <SectionRow id="appearance" summary={summaries.appearance} />
            <SectionRow id="integrations" summary={summaries.integrations} />
            <SectionRow id="security" summary={summaries.security} />
            <SectionRow id="data" summary={summaries.data} />
          </ul>
        </nav>
        <ShortcutsSection />
        <SettingsFooter />
      </SettingsStack>
    </>
  );
}
