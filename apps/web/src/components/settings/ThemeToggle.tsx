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

function ThemePreviewWindow({ dark }: { dark: boolean }) {
  return (
    <span
      className={cn(
        "absolute inset-0 flex gap-1.5 p-2",
        dark ? "bg-neutral-900" : "bg-white"
      )}
    >
      <span
        className={cn(
          "flex w-1/4 flex-col gap-1 rounded-sm p-1",
          dark ? "bg-neutral-800" : "bg-neutral-100"
        )}
      >
        <span className="h-1 w-3/4 rounded-full bg-primary" />
        <span
          className={cn(
            "h-1 w-full rounded-full",
            dark ? "bg-neutral-700" : "bg-neutral-200"
          )}
        />
        <span
          className={cn(
            "h-1 w-2/3 rounded-full",
            dark ? "bg-neutral-700" : "bg-neutral-200"
          )}
        />
      </span>
      <span className="grid flex-1 grid-cols-3 content-start gap-1">
        {["a", "b", "c", "d", "e", "f"].map((key) => (
          <span
            className={cn(
              "aspect-square rounded-sm",
              dark ? "bg-neutral-700" : "bg-neutral-200"
            )}
            key={key}
          />
        ))}
      </span>
    </span>
  );
}

function ThemePreview({
  selected,
  value,
}: {
  selected: boolean;
  value: ThemeValue;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block aspect-[16/10] w-full overflow-hidden rounded-xl border shadow-xs transition-[box-shadow,border-color] group-hover:border-foreground/25",
        selected &&
          "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background group-hover:border-primary"
      )}
    >
      {value === "system" ? (
        <>
          <ThemePreviewWindow dark={false} />
          <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
            <ThemePreviewWindow dark />
          </span>
        </>
      ) : (
        <ThemePreviewWindow dark={value === "dark"} />
      )}
    </span>
  );
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
    <div className="grid grid-cols-3 gap-4">
      {THEME_OPTIONS.map(({ value, icon: Icon }) => {
        const selected = hydrated && theme === value;
        return (
          <button
            aria-label={t(THEME_LABEL_KEYS[value])}
            aria-pressed={selected}
            className="group flex flex-col gap-2.5 rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            key={value}
            onClick={handleThemeChange(value)}
            type="button"
          >
            <ThemePreview selected={selected} value={value} />
            <span
              className={cn(
                "flex items-center gap-1.5 px-0.5 text-sm",
                selected ? "font-medium" : "text-muted-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {t(value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
