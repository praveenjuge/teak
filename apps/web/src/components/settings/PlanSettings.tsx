"use client";

import { FREE_TIER_LIMIT } from "@teak/convex/shared/constants";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { ExternalLink } from "vadivam-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { CustomerPortalButton } from "./CustomerPortalButton";
import {
  SettingsPageIntro,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";
import { SettingValueSkeleton } from "./SettingValueSkeleton";
import { ProFeatureList, UpgradeCard } from "./SubscriptionSection";

export interface PlanCheckout {
  loadingPlanId: string | null;
  monthlyPlanId: string;
  onCheckout: (planId: string) => void;
  yearlyPlanId: string;
}

interface UsageMeterProps {
  count: number;
  limit: number;
}

export function UsageMeter({ count, limit }: UsageMeterProps) {
  const t = useTranslations("settings.plan");
  const locale = useIntlLocale();
  const used = Math.min(count, limit);
  const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const full = count >= limit;
  const format = (value: number) => value.toLocaleString(locale);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">
          {t("usage", { count: format(count), limit: format(limit) })}
        </span>
        <span className="text-muted-foreground">
          {full
            ? t("limitReachedShort")
            : t("remaining", { count: limit - count })}
        </span>
      </div>
      <div
        aria-label={t("usageLabel")}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={used}
        aria-valuetext={t("usage", {
          count: format(count),
          limit: format(limit),
        })}
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            percent >= 90 ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface PlanSettingsProps {
  accountLoading: boolean;
  cardCount: number;
  checkout: PlanCheckout;
  hasPremium?: boolean;
  onCreateCustomerPortal: () => Promise<void>;
}

export function PlanSettings({
  accountLoading,
  cardCount,
  checkout,
  hasPremium,
  onCreateCustomerPortal,
}: PlanSettingsProps) {
  const t = useTranslations("settings.plan");
  const tPages = useTranslations("settings.pages");
  const tContent = useTranslations("settings.content");

  let current = (
    <div aria-hidden className="space-y-3">
      <SettingValueSkeleton className="mx-0 w-32" />
      <SettingValueSkeleton className="mx-0 h-2 w-full" />
    </div>
  );
  if (!accountLoading && hasPremium) {
    current = (
      <p className="text-muted-foreground text-sm">
        {t("unlimited", { count: cardCount })}
      </p>
    );
  } else if (!accountLoading) {
    current = (
      <div className="space-y-3">
        <UsageMeter count={cardCount} limit={FREE_TIER_LIMIT} />
        {cardCount >= FREE_TIER_LIMIT ? (
          <p className="text-destructive text-sm" role="status">
            {t("limitReached")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <SettingsPageIntro
        description={tPages("plan.description")}
        title={tPages("plan.title")}
      />
      <SettingsStack>
        <SettingsSection
          action={
            accountLoading ? null : (
              <Badge
                className="fade-in-0 animate-in duration-300"
                variant={hasPremium ? "default" : "outline"}
              >
                {hasPremium ? tContent("pro") : tContent("freePlan")}
              </Badge>
            )
          }
          description={
            hasPremium
              ? t("proDescription")
              : t("freeDescription", { limit: FREE_TIER_LIMIT })
          }
          footer={
            !accountLoading && hasPremium ? (
              <>
                <span className="text-muted-foreground text-xs">
                  {t("manageDescription")}
                </span>
                <CustomerPortalButton
                  aria-label={tContent("manageSubscription")}
                  className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
                  onCreatePortal={onCreateCustomerPortal}
                >
                  {tContent("manageSubscription")}
                  <ExternalLink className="size-4" />
                </CustomerPortalButton>
              </>
            ) : null
          }
          id="current-plan"
          title={t("currentTitle")}
        >
          {current}
        </SettingsSection>
        {!accountLoading && hasPremium ? (
          <SettingsSection id="pro-features">
            <ProFeatureList title={t("includedTitle")} />
          </SettingsSection>
        ) : null}
        {accountLoading || hasPremium ? null : <UpgradeCard {...checkout} />}
      </SettingsStack>
    </>
  );
}
