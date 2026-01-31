"use client";

import { useState } from "react";

interface PricingToggleProps {
  onToggle: (isYearly: boolean) => void;
  defaultYearly?: boolean;
}

export function PricingToggle({
  onToggle,
  defaultYearly = false,
}: PricingToggleProps) {
  const [isYearly, setIsYearly] = useState(defaultYearly);

  const handleToggle = (yearly: boolean) => {
    setIsYearly(yearly);
    onToggle(yearly);
  };

  return (
    <div className="mb-8 flex items-center justify-center">
      <div className="relative inline-flex rounded-lg border bg-muted p-px">
        <button
          className={`relative rounded-md px-4 py-1.5 font-medium ${
            isYearly
              ? "text-muted-foreground hover:text-foreground"
              : "border bg-background text-foreground"
          }`}
          onClick={() => handleToggle(false)}
          type="button"
        >
          Monthly
        </button>
        <button
          className={`relative rounded-md px-4 py-1.5 font-medium ${
            isYearly
              ? "border bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => handleToggle(true)}
          type="button"
        >
          Yearly
        </button>
      </div>
    </div>
  );
}
