import { Button } from "@teak/ui/components/ui/button";

interface PageErrorStateProps {
  message?: string;
  onRetry?: () => void;
  title?: string;
}

export function PageErrorState({
  title = "Something went wrong",
  message = "An unexpected error occurred. Please try again.",
  onRetry,
}: PageErrorStateProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-2">
        <h1 className="font-semibold text-foreground text-xl">{title}</h1>
        <p className="text-muted-foreground text-sm">{message}</p>
      </div>
      {onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
    </main>
  );
}
