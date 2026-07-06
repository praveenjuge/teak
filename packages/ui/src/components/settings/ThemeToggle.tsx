import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { THEME_OPTIONS, type ThemeValue } from "../../constants/settings";
import { Button } from "../ui/button";

interface ThemeToggleProps {
  onThemeChange?: (theme: ThemeValue) => void;
}

export function ThemeToggle({ onThemeChange }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes resolves the active theme only after mount; this one-time
  // guard avoids an SSR/client hydration mismatch on the active button.
  // react-doctor-disable-next-line react-doctor/rendering-hydration-no-flicker
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-initialize-state
    setMounted(true);
  }, []);

  const handleThemeChange = (value: ThemeValue) => () => {
    setTheme(value);
    onThemeChange?.(value);
  };

  return (
    <div className="flex items-center gap-px">
      {THEME_OPTIONS.map(({ label, value, icon: Icon }) => (
        <Button
          aria-label={`Use ${label} theme`}
          aria-pressed={mounted && theme === value}
          key={value}
          onClick={handleThemeChange(value)}
          size="sm"
          variant={mounted && theme === value ? "secondary" : "ghost"}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
