import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const themes = [
    {
      value: "light",
      icon: Sun,
    },
    {
      value: "dark",
      icon: Moon,
    },
    {
      value: "system",
      icon: Monitor,
    },
  ] as const;

  return (
    <div className="grid grid-cols-3 bg-accent rounded-lg">
      {themes.map((themeOption) => {
        const Icon = themeOption.icon;
        const isActive = theme === themeOption.value;
        return (
          <Button
            size="sm"
            key={themeOption.value}
            variant={isActive ? "outline" : "ghost"}
            onClick={() => setTheme(themeOption.value)}
          >
            <Icon />
          </Button>
        );
      })}
    </div>
  );
}
