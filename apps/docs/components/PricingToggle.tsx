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
    <div className="flex items-center justify-center mb-8">
      <div className="relative inline-flex rounded-lg border bg-muted p-px">
        <button
          onClick={() => handleToggle(false)}
          className={`relative px-4 py-1.5 font-medium rounded-md ${
            !isYearly
              ? "bg-background text-foreground border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => handleToggle(true)}
          className={`relative px-4 py-1.5 font-medium rounded-md ${
            isYearly
              ? "bg-background text-foreground border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Yearly
        </button>
      </div>
    </div>
  );
}
