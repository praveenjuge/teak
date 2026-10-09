import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { PRO_FEATURES } from "../../constants/settings";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { PlanOption } from "./PlanOption";
import { SettingsDialog, SettingsDialogBody } from "./SettingsDialog";

interface SubscriptionSectionProps {
  loadingPlanId: string | null;
  monthlyPlanId: string;
  onCheckout: (planId: string) => void;
  yearlyPlanId: string;
}

interface SubscriptionDialogProps extends SubscriptionSectionProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function planOptions(monthlyPlanId: string, yearlyPlanId: string) {
  return [
    {
      planId: monthlyPlanId,
      title: "Monthly",
      priceAmount: 1900,
      intervalLabel: "/ month",
    },
    {
      planId: yearlyPlanId,
      title: "Yearly",
      priceAmount: 9900,
      intervalLabel: "/ year",
      badge: "Best Value • 20% off",
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
  const plans = planOptions(monthlyPlanId, yearlyPlanId);

  return (
    <div className="space-y-6">
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="sr-only">Choose a plan</legend>
        {plans.map((plan) => (
          <PlanOption
            key={plan.planId}
            {...plan}
            // Locked while checkout opens, so the card shown is the plan bought.
            disabled={disabled}
            onSelect={onSelect}
            selected={selectedPlanId === plan.planId}
          />
        ))}
      </fieldset>

      <div className="space-y-3">
        <p className="font-medium text-sm">Everything in Pro</p>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
          {PRO_FEATURES.map((feature) => (
            <li
              className="flex items-center gap-2 text-muted-foreground text-sm"
              key={feature}
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SubscriptionDialog({
  loadingPlanId,
  monthlyPlanId,
  onCheckout,
  onOpenChange,
  open,
  yearlyPlanId,
}: SubscriptionDialogProps) {
  const [selectedPlanId, setSelectedPlanId] = useState(yearlyPlanId);
  const loading = loadingPlanId !== null;

  return (
    <SettingsDialog
      className="sm:max-w-lg"
      description="Unlock all features and remove limits."
      footer={
        <>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Maybe later
          </Button>
          <Button
            disabled={loading}
            onClick={() => onCheckout(selectedPlanId)}
            type="button"
          >
            {loading ? <Spinner /> : "Continue to checkout"}
          </Button>
        </>
      }
      icon={Sparkles}
      onOpenAutoFocus={(event) => {
        // Radix would focus the first (unselected) plan; start on the panel.
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.focus();
      }}
      onOpenChange={onOpenChange}
      open={open}
      title="Upgrade to Pro"
    >
      <SettingsDialogBody>
        <SubscriptionSection
          disabled={loading}
          monthlyPlanId={monthlyPlanId}
          onSelect={setSelectedPlanId}
          selectedPlanId={selectedPlanId}
          yearlyPlanId={yearlyPlanId}
        />
      </SettingsDialogBody>
    </SettingsDialog>
  );
}
