"use client";

import { useTranslations } from "@teak/i18n/react";
import { Loader2Icon } from "lucide-react";

import { cn } from "../../lib/utils";

interface SpinnerProps {
  className?: string;
}

function Spinner({ className }: SpinnerProps) {
  const t = useTranslations("ui");
  return (
    <Loader2Icon
      aria-label={t("loading")}
      className={cn("size-4 animate-spin", className)}
      role="status"
    />
  );
}

export { Spinner };
