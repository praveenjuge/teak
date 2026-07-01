import { cn } from "@teak/ui/lib/utils";
import { TopPattern } from "@teak/ui/patterns";
import type { ReactNode } from "react";

interface SettingsShellProps {
  backControl?: ReactNode;
  backLabel?: string;
  children: ReactNode;
  contentClassName?: string;
  onBack?: () => void;
  sectionClassName?: string;
  withMain?: boolean;
}

function SettingsShellContent({
  backControl,
  onBack,
  backLabel = "Back",
  children,
  contentClassName,
  sectionClassName,
}: Omit<SettingsShellProps, "withMain">) {
  let backElement: ReactNode = backControl;
  if (!backElement && onBack) {
    backElement = (
      <button
        className="inline-block font-medium text-primary hover:underline"
        onClick={onBack}
        type="button"
      >
        &larr; {backLabel}
      </button>
    );
  }

  return (
    <section
      className={cn(
        "mx-auto my-10 w-full max-w-md space-y-5",
        sectionClassName
      )}
    >
      {backElement}
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
