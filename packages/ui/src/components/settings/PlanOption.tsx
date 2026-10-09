import { cn } from "../../lib/utils";

interface PlanOptionProps {
  badge?: string;
  intervalLabel: string;
  onSelect: (planId: string) => void;
  planId: string;
  priceAmount: number;
  selected: boolean;
  title: string;
}

export function PlanOption({
  planId,
  title,
  priceAmount,
  intervalLabel,
  badge,
  selected,
  onSelect,
}: PlanOptionProps) {
  const formattedPrice = priceAmount
    ? `$${(priceAmount / 100).toLocaleString()}`
    : "--";

  return (
    <label
      className={cn(
        "relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 text-left transition-[border-color,box-shadow] hover:border-foreground/30 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
        selected && "border-primary ring-1 ring-primary hover:border-primary"
      )}
    >
      <input
        checked={selected}
        className="sr-only"
        name="plan"
        onChange={() => onSelect(planId)}
        type="radio"
        value={planId}
      />
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{title}</span>
        <span
          aria-hidden
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            selected && "border-primary bg-primary"
          )}
        >
          {selected ? (
            <span className="size-1.5 rounded-full bg-primary-foreground" />
          ) : null}
        </span>
      </span>
      <span className="flex items-baseline gap-1">
        <span className="font-semibold text-2xl text-foreground tracking-tight sm:text-3xl">
          {formattedPrice}
        </span>
        <span className="text-muted-foreground text-sm">{intervalLabel}</span>
      </span>
      {badge ? (
        <span className="w-fit rounded-md bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary leading-4 sm:rounded-full sm:text-xs">
          {badge}
        </span>
      ) : null}
    </label>
  );
}
