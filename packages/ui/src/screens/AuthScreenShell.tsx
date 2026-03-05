import { Card } from "@teak/ui/components/ui/card";
import { BottomPattern, TopPattern } from "@teak/ui/patterns";
import type { ReactNode } from "react";

interface AuthScreenShellProps {
  children: ReactNode;
  logo: ReactNode;
}

export function AuthScreenShell({ children, logo }: AuthScreenShellProps) {
  return (
    <section className="mx-auto flex w-full max-w-xs flex-col items-center gap-6 py-14 md:h-lh md:py-26">
      {logo}
      <Card className="w-full">{children}</Card>
      <TopPattern />
      <BottomPattern />
    </section>
  );
}
