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
      <div className="flex items-center gap-4">
        <div className="relative inline-flex rounded-lg bg-muted p-1">
          <button
            onClick={() => handleToggle(false)}
            className={`relative px-4 py-2 text-sm font-medium rounded-md transition-all ${
              !isYearly
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => handleToggle(true)}
            className={`relative px-4 py-2 text-sm font-medium rounded-md transition-all ${
              isYearly
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Yearly
          </button>
        </div>
      </div>
    </div>
  );
}
