import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** A Settings page's heading and what the page is for. */
export function SettingsPageIntro({
  description,
  title,
}: {
  description?: ReactNode;
  title: string;
}) {
  return (
    <div className="space-y-1 pb-8">
      <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
  );
}

interface SettingsSectionProps {
  /** A control beside the title, such as a toggle or a short button. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  footer?: ReactNode;
  /** The element id a deep link (`#id`) scrolls to; also names the region. */
  id: string;
  title?: string;
  tone?: "default" | "destructive";
}

/**
 * One group of settings on a page: a title and description, then its
 * controls. Groups sit on the page itself, set apart by space.
 */
export function SettingsSection({
  action,
  children,
  className,
  description,
  footer,
  id,
  title,
  tone = "default",
}: SettingsSectionProps) {
  const titleId = `${id}-title`;
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn("scroll-mt-20", className)}
      data-slot="settings-section"
      id={id}
    >
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h3
              className={cn(
                "font-medium text-sm leading-6",
                tone === "destructive" && "text-destructive"
              )}
              id={titleId}
            >
              {title}
            </h3>
            {description ? (
              <p className="max-w-prose text-[13px] text-muted-foreground leading-5">
                {description}
              </p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      {children ? <div className={title ? "mt-4" : ""}>{children}</div> : null}
      {footer ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** A page's sections, spaced the same on every page. */
export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>;
}
