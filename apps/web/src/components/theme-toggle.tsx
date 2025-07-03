import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const themes = [
    {
      value: "light",
      label: "Light",
      icon: Sun,
    },
    {
      value: "dark",
      label: "Dark",
      icon: Moon,
    },
    {
      value: "system",
      label: "System",
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
            key={themeOption.value}
            variant={isActive ? "outline" : "ghost"}
            size="sm"
            onClick={() => setTheme(themeOption.value)}
          >
            <Icon />
            <span className="text-xs">{themeOption.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
