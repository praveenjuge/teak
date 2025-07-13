import type { LucideIcon } from 'lucide-react';
import { Button } from './ui/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-96 max-w-xs flex-col items-center justify-center p-8 text-center">
      <div className="mx-auto flex size-8 items-center justify-center rounded border bg-muted">
        <Icon className="size-4 stroke-[2.5px] text-foreground" />
      </div>
      <h2 className="mt-4 text-balance font-semibold">{title}</h2>
      <p className="mt-1 text-balance text-muted-foreground">{description}</p>
      {action && (
        <Button
          className="mt-6"
          onClick={action.onClick}
          size="sm"
          variant="outline"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
