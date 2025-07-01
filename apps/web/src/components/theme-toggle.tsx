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
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Appearance</p>
      <div className="grid grid-cols-3 gap-1 p-0.5 bg-accent rounded-lg border">
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
                h-8 px-2 justify-center shadow-none
                ${isActive ? "bg-background border hover:bg-background dark:hover:bg-background" : ""}
              `}
            >
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              <span className="text-xs font-medium">{themeOption.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
