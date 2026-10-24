"use client";

import { useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { buttonVariants } from "@/components/ui/button";

export function NotFoundContent() {
  const t = useTranslations("app.notFound");
  return (
    <div className="flex max-w-xs flex-col items-center gap-6 text-center">
      <Wordmark className="h-6 w-auto text-foreground" variant="current" />
      <div className="space-y-2">
        <h1 className="font-semibold text-foreground text-lg">{t("title")}</h1>
        <p className="text-balance text-base text-muted-foreground">
          {t("body")}
        </p>
      </div>
      <Link
        className={buttonVariants({ className: "min-w-32", size: "lg" })}
        href="/"
      >
        {t("goHome")}
      </Link>
    </div>
  );
}
