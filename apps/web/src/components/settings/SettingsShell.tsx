import type { ReactNode } from "react";

interface SettingsShellProps {
  children: ReactNode;
  header?: ReactNode;
  nav?: ReactNode;
}

export function SettingsShell({ children, header, nav }: SettingsShellProps) {
  return (
    <>
      {header}
      <div className="mt-2 mb-10 flex w-full max-w-5xl gap-10">
        {nav ? (
          <aside className="hidden w-52 shrink-0 md:block">
            <div className="sticky top-16">{nav}</div>
          </aside>
        ) : null}
        <div className="min-w-0 max-w-2xl flex-1" data-slot="settings-content">
          {children}
        </div>
      </div>
    </>
  );
}
