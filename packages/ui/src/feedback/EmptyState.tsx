interface EmptyStateProps {
  message?: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center rounded-xl border bg-card p-8 text-center">
      <p className="text-muted-foreground text-sm">
        {message ?? "No cards yet. Your saved cards will appear here."}
      </p>
    </div>
  );
}
