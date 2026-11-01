import { useTranslations } from "@teak/i18n/react";
import { Wordmark, type WordmarkProps } from "./Wordmark";

export interface LogoProps extends WordmarkProps {}

export default function Logo({
  className,
  variant = "default",
  ...wordmarkProps
}: LogoProps) {
  const t = useTranslations("screens.logo");
  const wordmarkClassName = className
    ? `pointer-events-none h-5 w-auto shrink-0 select-none ${className}`
    : "pointer-events-none h-5 w-auto shrink-0 select-none";

  return (
    <div className="flex items-center space-x-2">
      <Wordmark
        {...wordmarkProps}
        className={wordmarkClassName}
        variant={variant}
      />
      <span
        className="inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-xl border bg-background px-2 py-0.5 font-medium text-foreground text-xs transition-[color,box-shadow]"
        data-slot="badge"
      >
        {t("earlyAccess")}
      </span>
    </div>
  );
}
