"use client";

import { FREE_TIER_LIMIT } from "@teak/convex/shared/constants";
import { LOCALE_NAMES } from "@teak/i18n";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { ChevronRight, LogOut } from "vadivam-react";
import { useHydrated } from "@/hooks/useHydrated";
import { useLocalDateFormat } from "@/hooks/useLocalDateFormat";
import { openKeyboardShortcuts } from "@/lib/keyboardShortcuts";
import {
  SETTINGS_PLAN_HREF,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "@/lib/settingsSections";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Spinner } from "../ui/spinner";
import type { ExportState } from "./ExportPanel";
import { AppsSection } from "./IntegrationsSettings";
import { UsageMeter } from "./PlanSettings";
import { SettingsFooter } from "./SettingsFooter";
import {
  SettingsPageIntro,
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
  let who: ReactNode = <SettingValueSkeleton className="mx-0 mt-1.5 w-56" />;
  if (!accountLoading) {
    who = (
      <span className={`${LOADED} [overflow-wrap:anywhere]`}>
        {displayName ? (
          <>
            <span className="text-foreground">{displayName}</span>
            {" · "}
          </>
        ) : null}
        <span>{email ?? tContent("notAvailable")}</span>
      </span>
    );
  }
  return (
    <SettingsSection
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
      description={who}
      id="profile"
      title={t("signedInAs")}
    />
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
  const Icon = section.icon;
  return (
    <li>
      <Link
        className="group flex items-center gap-3.5 px-4 py-3.5 outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/50 focus-visible:bg-accent/50"
        href={section.href}
      >
        <Icon className="size-[18px] shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-sm leading-5">{t(id)}</span>
          <span className="block min-h-5 truncate text-[13px] text-muted-foreground leading-5">
            {summary ?? <SettingValueSkeleton className="mx-0 mt-1.5 w-28" />}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-70 transition-transform group-hover:translate-x-0.5" />
      </Link>
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

function UsageSection({
  accountLoading,
  cardCount,
  hasPremium,
}: Pick<SettingsOverviewProps, "accountLoading" | "cardCount" | "hasPremium">) {
  const t = useTranslations("settings.plan");
  const tSubscription = useTranslations("settings.subscription");
  let usage: ReactNode = (
    <div aria-hidden className="space-y-3">
      <SettingValueSkeleton className="mx-0 w-32" />
      <SettingValueSkeleton className="mx-0 h-2 w-full" />
    </div>
  );
  if (!accountLoading && hasPremium) {
    usage = (
      <p className={`${LOADED} text-muted-foreground text-sm`}>
        {t("unlimited", { count: cardCount })}
      </p>
    );
  } else if (!accountLoading) {
    usage = (
      <div className={LOADED}>
        <UsageMeter count={cardCount} limit={FREE_TIER_LIMIT} />
      </div>
    );
  }
  return (
    <SettingsSection
      action={
        accountLoading || hasPremium ? null : (
          <Button asChild size="sm">
            <Link href={SETTINGS_PLAN_HREF}>{tSubscription("title")}</Link>
          </Button>
        )
      }
      id="usage"
      title={t("usageLabel")}
    >
      {usage}
    </SettingsSection>
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
            variant="outline"
          >
            <Kbd className="bg-background">?</Kbd>
          </Button>
        }
        description={t("description")}
        id="shortcuts"
        title={t("title")}
      />
    </div>
  );
}

export function SettingsOverview(props: SettingsOverviewProps) {
  const t = useTranslations("settings.overview");
  const tNav = useTranslations("settings.nav");
  const tPages = useTranslations("settings.pages");
  const summaries = useSummaries(props);
  return (
    <>
      <SettingsPageIntro
        description={tPages("account.description")}
        title={tNav("account")}
      />
      <SettingsStack>
        <ProfileSection {...props} />
        <UsageSection {...props} />
        {/* Wide screens list the sections beside the page (SettingsNav). */}
        <nav aria-label={t("sectionsLabel")} className="md:hidden">
          <ul className="divide-y rounded-xl border">
            <SectionRow id="plan" summary={summaries.plan} />
            <SectionRow id="appearance" summary={summaries.appearance} />
            <SectionRow id="integrations" summary={summaries.integrations} />
            <SectionRow id="security" summary={summaries.security} />
            <SectionRow id="data" summary={summaries.data} />
          </ul>
        </nav>
        <AppsSection />
        <ShortcutsSection />
      </SettingsStack>
      <SettingsFooter />
    </>
  );
}
