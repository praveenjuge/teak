import { cn } from "@teak/ui/lib/utils";
import type { ReactNode } from "react";

interface SettingsShellProps {
  children: ReactNode;
  contentClassName?: string;
  header?: ReactNode;
  sectionClassName?: string;
  withMain?: boolean;
}

function SettingsShellContent({
  children,
  contentClassName,
  header,
  sectionClassName,
}: Omit<SettingsShellProps, "withMain">) {
  return (
    <>
      {header}
      <section
        className={cn("mt-2 mb-10 w-full max-w-md space-y-5", sectionClassName)}
      >
        <div
          className={cn(
            "space-y-5 rounded-2xl border bg-background p-7",
            contentClassName
          )}
        >
          {children}
        </div>
      </section>
    </>
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
