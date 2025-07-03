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
    <div className="grid grid-cols-3 bg-accent rounded-lg border p-px">
      {themes.map((themeOption) => {
        const Icon = themeOption.icon;
        const isActive = theme === themeOption.value;

        return (
          <Button
            key={themeOption.value}
            variant="ghost"
            size="sm"
            onClick={() => setTheme(themeOption.value)}
            className={`
                ${isActive ? "bg-background border hover:bg-background dark:hover:bg-background" : ""}
              `}
          >
            <Icon />
            <span className="text-xs">{themeOption.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
