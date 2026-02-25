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

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleThemeChange = (value: ThemeValue) => () => {
    setTheme(value);
    onThemeChange?.(value);
  };

  return (
    <div className="flex items-center gap-px">
      {THEME_OPTIONS.map(({ value, icon: Icon }) => (
        <Button
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
