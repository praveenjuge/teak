import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useState } from "react";
import { Check, Sparkles } from "vadivam-react";
import {
  PRO_MONTHLY_PRICE_CENTS,
  PRO_YEARLY_PRICE_CENTS,
  yearlySavingsPercent,
} from "../../constants/billing";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { PlanOption } from "./PlanOption";
import { SettingsSection } from "./SettingsSection";

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
      planId: monthlyPlanId,
      title: t("monthly"),
      priceAmount: PRO_MONTHLY_PRICE_CENTS,
      intervalLabel: t("perMonth"),
    },
    {
      planId: yearlyPlanId,
      title: t("yearly"),
      priceAmount: PRO_YEARLY_PRICE_CENTS,
      intervalLabel: t("perYear"),
      badge: t("bestValue", { percent: yearlySavingsPercent() }),
    },
  ];
}

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
    <div className="space-y-6">
      <fieldset className="grid grid-cols-2 gap-3">
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

      <ProFeatureList />
    </div>
  );
}

/** What Pro includes, as a checklist. */
export function ProFeatureList({ title }: { title?: string }) {
  const t = useTranslations("settings.subscription");
  return (
    <div className="space-y-3">
      <p className="font-medium text-sm">{title ?? t("everythingInPro")}</p>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
        {PRO_FEATURE_KEYS.map((feature) => (
          <li
            className="flex items-center gap-2 text-muted-foreground text-sm"
            key={feature}
          >
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            <span>{t(`features.${feature}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Settings → Plan, on the free plan: pick monthly or yearly and check out. */
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
    <SettingsSection
      description={t("description")}
      footer={
        <>
          <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Sparkles className="size-3.5" />
            {t("cancelAnytime")}
          </span>
          <Button
            disabled={loading}
            onClick={() => onCheckout(selectedPlanId)}
            type="button"
          >
            {loading ? <Spinner /> : t("continueToCheckout")}
          </Button>
        </>
      }
      id="upgrade"
      title={t("title")}
    >
      <SubscriptionSection
        disabled={loading}
        monthlyPlanId={monthlyPlanId}
        onSelect={setSelectedPlanId}
        selectedPlanId={selectedPlanId}
        yearlyPlanId={yearlyPlanId}
      />
    </SettingsSection>
  );
}
