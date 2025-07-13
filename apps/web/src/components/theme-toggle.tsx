import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const themes = [
    {
      value: 'light',
      icon: Sun,
    },
    {
      value: 'dark',
      icon: Moon,
    },
    {
      value: 'system',
      icon: Monitor,
    },
  ] as const;

  return (
    <div className="grid grid-cols-3 rounded-lg bg-accent">
      {themes.map((themeOption) => {
        const Icon = themeOption.icon;
        const isActive = theme === themeOption.value;
        return (
          <Button
            key={themeOption.value}
            onClick={() => setTheme(themeOption.value)}
            size="sm"
            variant={isActive ? 'outline' : 'ghost'}
          >
            <Icon />
          </Button>
        );
      })}
    </div>
  );
}
