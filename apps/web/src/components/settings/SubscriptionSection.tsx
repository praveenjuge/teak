import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useState } from "react";
import { Check } from "vadivam-react";
import {
  PRO_MONTHLY_PRICE_CENTS,
  PRO_YEARLY_PRICE_CENTS,
  yearlySavingsPercent,
} from "../../constants/billing";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { PlanOption } from "./PlanOption";
import { SettingsCaption, SettingsGroup } from "./SettingsSection";

interface SubscriptionSectionProps {
  loadingPlanId: string | null;
  monthlyPlanId: string;
  onCheckout: (planId: string) => void;
  yearlyPlanId: string;
}

const PRO_FEATURE_KEYS = [
  "unlimitedCards",
  "unlimitedStorage",
  "summaryAndTags",
  "audioTranscription",
  "browserExtensions",
  "apps",
  "apiAndMcp",
] as const;

function planOptions(
  t: TeakTranslator<"settings.subscription">,
  monthlyPlanId: string,
  yearlyPlanId: string
) {
  return [
    {
      planId: yearlyPlanId,
      title: t("yearly"),
      priceAmount: PRO_YEARLY_PRICE_CENTS,
      intervalLabel: t("perYear"),
      badge: t("bestValue", { percent: yearlySavingsPercent() }),
    },
    {
      planId: monthlyPlanId,
      title: t("monthly"),
      priceAmount: PRO_MONTHLY_PRICE_CENTS,
      intervalLabel: t("perMonth"),
    },
  ];
}

/** The two Pro plans to pick from. */
export function SubscriptionSection({
  disabled = false,
  monthlyPlanId,
  onSelect,
  selectedPlanId,
  yearlyPlanId,
}: Pick<SubscriptionSectionProps, "monthlyPlanId" | "yearlyPlanId"> & {
  disabled?: boolean;
  onSelect: (planId: string) => void;
  selectedPlanId: string;
}) {
  const t = useTranslations("settings.subscription");
  const plans = planOptions(t, monthlyPlanId, yearlyPlanId);

  return (
    <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <legend className="sr-only">{t("choosePlan")}</legend>
      {plans.map((plan) => (
        <PlanOption
          key={plan.planId}
          {...plan}
          disabled={disabled}
          onSelect={onSelect}
          selected={selectedPlanId === plan.planId}
        />
      ))}
    </fieldset>
  );
}

export function ProFeatureList() {
  const t = useTranslations("settings.subscription");
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-2.5 px-4 py-4 sm:grid-cols-2">
      {PRO_FEATURE_KEYS.map((feature) => (
        <li
          className="flex items-center gap-2 text-muted-foreground text-sm"
          key={feature}
        >
          <Check className="size-3.5 shrink-0 text-primary" strokeWidth={2.5} />
          <span>{t(`features.${feature}`)}</span>
        </li>
      ))}
    </ul>
  );
}

export function UpgradeCard({
  loadingPlanId,
  monthlyPlanId,
  onCheckout,
  yearlyPlanId,
}: SubscriptionSectionProps) {
  const t = useTranslations("settings.subscription");
  const [selectedPlanId, setSelectedPlanId] = useState(yearlyPlanId);
  const loading = loadingPlanId !== null;

  return (
    <section
      aria-labelledby="upgrade-title"
      className="scroll-mt-20 space-y-2"
      data-slot="settings-section"
      id="upgrade"
    >
      <SettingsCaption id="upgrade-title" title={t("title")} />
      <SubscriptionSection
        disabled={loading}
        monthlyPlanId={monthlyPlanId}
        onSelect={setSelectedPlanId}
        selectedPlanId={selectedPlanId}
        yearlyPlanId={yearlyPlanId}
      />
      <SettingsGroup className="mt-3">
        <div>
          <p className="px-4 pt-4 font-medium text-[13px] text-muted-foreground leading-5">
            {t("everythingInPro")}
          </p>
          <ProFeatureList />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-[13px] text-muted-foreground">
            {t("cancelAnytime")}
          </span>
          <Button
            disabled={loading}
            onClick={() => onCheckout(selectedPlanId)}
            type="button"
          >
            {loading ? <Spinner /> : t("continueToCheckout")}
          </Button>
        </div>
      </SettingsGroup>
    </section>
  );
}
