import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { buttonVariants } from "../ui/button";
import { Spinner } from "../ui/spinner";

interface PlanOptionProps {
  badge?: string;
  intervalLabel: string;
  isLoading: boolean;
  onCheckout: (planId: string) => void;
  planId: string;
  priceAmount: number;
  title: string;
}

export function PlanOption({
  planId,
  title,
  priceAmount,
  intervalLabel,
  badge,
  isLoading,
  onCheckout,
}: PlanOptionProps) {
  const formattedPrice = priceAmount
    ? `${(priceAmount / 100).toLocaleString()}$`
    : "--";

  return (
    <div className="relative flex w-full flex-col justify-between gap-4 overflow-hidden rounded-md border bg-background p-5 text-left">
      {badge && (
        <Badge className="absolute top-0 right-0 rounded-none rounded-bl-md px-3">
          {badge}
        </Badge>
      )}
      <p className="font-medium text-muted-foreground">{title}</p>
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-2">
          <p className="font-semibold text-4xl text-foreground">
            {formattedPrice}
          </p>
          <p className="pb-1 text-muted-foreground">{intervalLabel}</p>
        </div>

        <button
          className={cn(
            buttonVariants({
              variant: "outline",
            })
          )}
          disabled={isLoading}
          onClick={() => onCheckout(planId)}
          type="button"
        >
          {isLoading ? (
            <Spinner />
          ) : (
            <span className="flex items-center gap-2">
              Continue <ArrowRight className="size-4" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
