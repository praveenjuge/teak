import { useTranslations } from "@teak/i18n/react";
import { useTheme } from "next-themes";
import { THEME_OPTIONS, type ThemeValue } from "../../constants/settings";
import { useHydrated } from "../../hooks/useHydrated";
import { cn } from "../../lib/utils";

const THEME_LABEL_KEYS = {
  system: "useSystem",
  light: "useLight",
  dark: "useDark",
} as const satisfies Record<ThemeValue, string>;

interface ThemeToggleProps {
  onThemeChange?: (theme: ThemeValue) => void;
}

/** System, Light and Dark as one segmented control. */
export function ThemeToggle({ onThemeChange }: ThemeToggleProps) {
  const t = useTranslations("settings.theme");
  const tAppearance = useTranslations("settings.appearance");
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <fieldset className="inline-flex min-w-0 rounded-lg bg-muted p-0.5">
      <legend className="sr-only">{tAppearance("themeTitle")}</legend>
      {THEME_OPTIONS.map(({ value, icon: Icon }) => {
        const selected = hydrated && theme === value;
        return (
          <button
            aria-label={t(THEME_LABEL_KEYS[value])}
            aria-pressed={selected}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring",
              selected
                ? "bg-background font-medium text-foreground shadow-xs dark:bg-accent"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={value}
            onClick={() => {
              setTheme(value);
              onThemeChange?.(value);
            }}
            type="button"
          >
            <Icon className="size-3.5" />
            {t(value)}
          </button>
        );
      })}
    </fieldset>
  );
}
