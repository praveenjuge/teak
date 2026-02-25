import { CheckCircle2 } from "lucide-react";
import { PRO_FEATURES } from "../../constants/settings";
import { DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { PlanOption } from "./PlanOption";

interface SubscriptionSectionProps {
  loadingPlanId: string | null;
  monthlyPlanId: string;
  onCheckout: (planId: string) => void;
  yearlyPlanId: string;
}

export function SubscriptionSection({
  onCheckout,
  loadingPlanId,
  monthlyPlanId,
  yearlyPlanId,
}: SubscriptionSectionProps) {
  const plans = [
    {
      planId: monthlyPlanId,
      title: "Monthly",
      priceAmount: 1900,
      intervalLabel: "Per Month",
    },
    {
      planId: yearlyPlanId,
      title: "Yearly",
      priceAmount: 9900,
      intervalLabel: "Per Year",
      badge: "Best Value • 20% off",
    },
  ];

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>Upgrade to Pro</DialogTitle>
        <DialogDescription>
          Unlock all features and remove limits.
        </DialogDescription>
      </DialogHeader>

      {plans.map((plan) => (
        <PlanOption
          key={plan.planId}
          {...plan}
          isLoading={loadingPlanId === plan.planId}
          onCheckout={onCheckout}
        />
      ))}

      <div className="space-y-3 text-left">
        <p className="font-medium text-muted-foreground text-sm">
          Pro Features included:
        </p>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {PRO_FEATURES.map((feature) => (
            <li className="flex items-center gap-1.5 text-sm" key={feature}>
              <CheckCircle2 className="size-4 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
