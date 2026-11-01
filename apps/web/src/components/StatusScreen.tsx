import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";

export function StatusScreen({
  message,
  action,
  onAction,
  role = "alert",
  children,
}: {
  message: string;
  action: string;
  onAction: () => void;
  role?: "alert" | "status";
  children?: ReactNode;
}) {
  return (
    <section className="fixed inset-0 grid place-items-center p-6">
      <div
        className="flex max-w-xs flex-col items-center gap-6 text-center"
        role={role}
      >
        <Wordmark className="h-6 w-auto text-foreground" variant="current" />
        <p className="text-balance text-base text-muted-foreground">
          {message}
        </p>
        <div className="flex flex-col items-center gap-2">
          <Button className="min-w-32" onClick={onAction} size="lg">
            {action}
          </Button>
          {children}
        </div>
      </div>
    </section>
  );
}
