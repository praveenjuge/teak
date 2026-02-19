import Logo from "../../logo";
import type { AddCardFormProps } from "./AddCardForm";
import { AddCardForm } from "./AddCardForm";

export interface AddCardEmptyStateProps
  extends Omit<AddCardFormProps, "autoFocus"> {
  autoFocus?: boolean;
  description?: string;
  title?: string;
}

const DEFAULT_TITLE = "Let's add your first card!";
const DEFAULT_DESCRIPTION =
  "Start capturing your thoughts, links, and media above";

export function AddCardEmptyState({
  autoFocus = true,
  description = DEFAULT_DESCRIPTION,
  title = DEFAULT_TITLE,
  ...addCardFormProps
}: AddCardEmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-xs flex-col items-center gap-5 py-20 text-center">
      <Logo variant="current" />
      <AddCardForm autoFocus={autoFocus} {...addCardFormProps} />
      <div className="space-y-1">
        <h3 className="font-medium">{title}</h3>
        <p className="text-balance text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
