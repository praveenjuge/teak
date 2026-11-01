"use client";

import { FREE_TIER_LIMIT } from "@teak/convex/shared/constants";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import { ArrowUpRight, Sparkles } from "vadivam-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { CustomerPortalButton } from "./CustomerPortalButton";
import {
  SettingsCaption,
  SettingsGroup,
  SettingsPageIntro,
  SettingsRow,
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

/** "N of 200 cards" with a slim bar, for the right side of a row. */
export function UsageMeter({ count, limit }: UsageMeterProps) {
  const t = useTranslations("settings.plan");
  const locale = useIntlLocale();
  const used = Math.min(count, limit);
  const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const format = (value: number) => value.toLocaleString(locale);
  const usage = t("usage", { count: format(count), limit: format(limit) });
  return (
    <div className="flex items-center gap-3">
      <div
        aria-label={t("usageLabel")}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={used}
        aria-valuetext={usage}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:w-28"
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
      <span className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
        {usage}
      </span>
    </div>
  );
}

/** "M cards left", or "Limit reached" in red once the plan is full. */
export function UsageRemaining({ count, limit }: UsageMeterProps) {
  const t = useTranslations("settings.plan");
  return count >= limit ? (
    <span className="text-destructive">{t("limitReachedShort")}</span>
  ) : (
    <span>{t("remaining", { count: limit - count })}</span>
  );
}

function ProHero() {
  const t = useTranslations("settings.plan");
  return (
    <div className="fade-in-0 flex animate-in items-center gap-4 rounded-xl border bg-card px-5 py-5 duration-300">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-primary/35 text-primary"
      >
        <Sparkles className="size-5" strokeWidth={1.6} />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-[11px] text-primary uppercase leading-4 tracking-[0.12em]">
          {t("proEyebrow")}
        </p>
        <p className="mt-0.5 font-semibold text-[17px] leading-6 tracking-tight">
          {t("proTitle")}
        </p>
        <p className="text-[13px] text-muted-foreground leading-5">
          {t("proThanks")}
        </p>
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
  const pro = !accountLoading && hasPremium;
  const free = !(accountLoading || hasPremium);

  let usage: ReactNode = (
    <span aria-hidden className="flex items-center gap-3">
      <SettingValueSkeleton className="mx-0 h-1.5 w-24" />
      <SettingValueSkeleton className="mx-0 w-24" />
    </span>
  );
  if (pro) {
    usage = (
      <span className="text-muted-foreground text-sm">
        {t("unlimited", { count: cardCount })}
      </span>
    );
  } else if (free) {
    usage = <UsageMeter count={cardCount} limit={FREE_TIER_LIMIT} />;
  }

  return (
    <>
      <SettingsPageIntro title={tPages("plan.title")} />
      <SettingsStack>
        {pro ? <ProHero /> : null}
        <section
          aria-labelledby="current-plan-title"
          className="scroll-mt-20"
          id="current-plan"
        >
          <SettingsGroup>
            <SettingsRow
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
              label={t("currentTitle")}
              labelId="current-plan-title"
            />
            <SettingsRow
              action={usage}
              description={
                free ? (
                  <UsageRemaining count={cardCount} limit={FREE_TIER_LIMIT} />
                ) : null
              }
              label={t("usageLabel")}
            />
            {free && cardCount >= FREE_TIER_LIMIT ? (
              <p
                className="px-4 py-2.5 text-[13px] text-destructive leading-5"
                role="status"
              >
                {t("limitReached")}
              </p>
            ) : null}
            {pro ? (
              <SettingsRow
                action={
                  <CustomerPortalButton
                    aria-label={tContent("manageSubscription")}
                    className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
                    onCreatePortal={onCreateCustomerPortal}
                  >
                    {tContent("manageSubscription")}
                    <ArrowUpRight className="size-3.5" />
                  </CustomerPortalButton>
                }
                label={t("billingTitle")}
              />
            ) : null}
          </SettingsGroup>
        </section>
        {pro ? (
          <section
            aria-labelledby="pro-features-title"
            className="space-y-2"
            id="pro-features"
          >
            <SettingsCaption
              id="pro-features-title"
              title={t("includedTitle")}
            />
            <SettingsGroup>
              <ProFeatureList />
            </SettingsGroup>
          </section>
        ) : null}
        {free ? <UpgradeCard {...checkout} /> : null}
      </SettingsStack>
    </>
  );
}
