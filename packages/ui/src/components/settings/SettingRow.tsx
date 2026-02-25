import type { ReactNode } from "react";
import { CardTitle } from "../ui/card";

interface SettingRowProps {
  children: ReactNode;
  title: string;
}

export function SettingRow({ title, children }: SettingRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle>{title}</CardTitle>
      <div className="-mx-2.5 flex items-center justify-end gap-2 -space-x-2.5">
        {children}
      </div>
    </div>
  );
}
