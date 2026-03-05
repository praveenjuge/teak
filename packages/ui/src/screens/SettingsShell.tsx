import { cn } from "@teak/ui/lib/utils";
import { TopPattern } from "@teak/ui/patterns";
import type { ReactNode } from "react";

interface SettingsShellProps {
  backControl: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  sectionClassName?: string;
  withMain?: boolean;
}

function SettingsShellContent({
  backControl,
  children,
  contentClassName,
  sectionClassName,
}: Omit<SettingsShellProps, "withMain">) {
  return (
    <section
      className={cn(
        "mx-auto my-10 w-full max-w-md space-y-5",
        sectionClassName
      )}
    >
      {backControl}
      <div
        className={cn(
          "space-y-5 rounded-lg border bg-background p-7",
          contentClassName
        )}
      >
        {children}
      </div>
      <TopPattern />
    </section>
  );
}

export function SettingsShell({
  withMain = false,
  ...contentProps
}: SettingsShellProps) {
  if (!withMain) {
    return <SettingsShellContent {...contentProps} />;
  }

  return (
    <main className="min-h-screen">
      <SettingsShellContent {...contentProps} />
    </main>
  );
}
