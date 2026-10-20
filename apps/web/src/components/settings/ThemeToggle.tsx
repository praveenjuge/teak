import { useTheme } from "next-themes";
import { THEME_OPTIONS, type ThemeValue } from "../../constants/settings";
import { useHydrated } from "../../hooks/useHydrated";
import { Button } from "../ui/button";

interface ThemeToggleProps {
  onThemeChange?: (theme: ThemeValue) => void;
}

export function ThemeToggle({ onThemeChange }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  const handleThemeChange = (value: ThemeValue) => () => {
    setTheme(value);
    onThemeChange?.(value);
  };

  return (
    <div className="flex items-center gap-px">
      {THEME_OPTIONS.map(({ label, value, icon: Icon }) => (
        <Button
          aria-label={`Use ${label} theme`}
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
