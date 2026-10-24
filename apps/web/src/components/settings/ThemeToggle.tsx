import { useTranslations } from "@teak/i18n/react";
import { useTheme } from "next-themes";
import { THEME_OPTIONS, type ThemeValue } from "../../constants/settings";
import { useHydrated } from "../../hooks/useHydrated";
import { Button } from "../ui/button";

const THEME_LABEL_KEYS = {
  system: "useSystem",
  light: "useLight",
  dark: "useDark",
} as const satisfies Record<ThemeValue, string>;

interface ThemeToggleProps {
  onThemeChange?: (theme: ThemeValue) => void;
}

export function ThemeToggle({ onThemeChange }: ThemeToggleProps) {
  const t = useTranslations("settings.theme");
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  const handleThemeChange = (value: ThemeValue) => () => {
    setTheme(value);
    onThemeChange?.(value);
  };

  return (
    <div className="flex items-center gap-px">
      {THEME_OPTIONS.map(({ value, icon: Icon }) => (
        <Button
          aria-label={t(THEME_LABEL_KEYS[value])}
          aria-pressed={hydrated && theme === value}
          key={value}
          onClick={handleThemeChange(value)}
          size="sm"
          variant={hydrated && theme === value ? "secondary" : "ghost"}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
