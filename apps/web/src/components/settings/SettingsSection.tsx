import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowUpRight, ChevronRight, type VadivamIcon } from "vadivam-react";
import { cn } from "../../lib/utils";

/** The page's own heading, under the header's "Settings › Page" breadcrumb. */
export function SettingsPageIntro({ title }: { title: string }) {
  return (
    <h2 className="pb-6 font-semibold text-[22px] leading-7 tracking-tight">
      {title}
    </h2>
  );
}

/** A rounded card of rows, divided by hairlines. */
export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y overflow-hidden rounded-xl border bg-card",
        className
      )}
      data-slot="settings-group"
    >
      {children}
    </div>
  );
}

/** The small label above a group, with an optional action at its end. */
export function SettingsCaption({
  action,
  id,
  title,
}: {
  action?: ReactNode;
  id?: string;
  title?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 px-1">
      {title ? (
        <h3
          className="font-medium text-[13px] text-muted-foreground leading-5"
          id={id}
        >
          {title}
        </h3>
      ) : (
        <span />
      )}
      {action}
    </div>
  );
}

const TILE_TONES = {
  amber: "bg-amber-500 text-white",
  blue: "bg-blue-500 text-white",
  cyan: "bg-cyan-600 text-white",
  emerald: "bg-emerald-500 text-white",
  gray: "bg-zinc-500 text-white",
  indigo: "bg-indigo-500 text-white",
  muted: "bg-muted text-muted-foreground",
} as const;

export type SettingsTileTone = keyof typeof TILE_TONES;

/** A small rounded square holding a row's icon, like macOS settings. */
export function SettingsTile({
  className,
  icon: Icon,
  size = "md",
  tone = "muted",
}: {
  className?: string;
  icon: VadivamIcon;
  size?: "sm" | "md";
  tone?: SettingsTileTone;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "sm" ? "size-[22px] rounded-md" : "size-7 rounded-lg",
        TILE_TONES[tone],
        className
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={2} />
    </span>
  );
}

/** A brand mark, such as Chrome's, on a white tile in both themes. */
export function SettingsLogoTile({ src }: { src: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-white"
    >
      {/* biome-ignore lint/performance/noImgElement: a small static SVG */}
      <img
        alt=""
        className="size-[18px] object-contain"
        height={18}
        src={src}
        width={18}
      />
    </span>
  );
}

interface SettingsRowProps {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  id?: string;
  label: ReactNode;
  /** Renders the label as the group's heading, for `aria-labelledby`. */
  labelId?: string;
  tone?: "default" | "destructive";
}

/** One setting: its name on the left, its control on the right. */
export function SettingsRow({
  action,
  className,
  description,
  icon,
  id,
  label,
  labelId,
  tone = "default",
}: SettingsRowProps) {
  const labelClass = cn(
    "font-normal text-sm leading-5",
    tone === "destructive" && "text-destructive"
  );
  return (
    <div
      className={cn(
        "flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5",
        className
      )}
      data-slot="settings-row"
      id={id}
    >
      <div className="flex min-w-0 flex-1 basis-24 items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          {labelId ? (
            <h3 className={labelClass} id={labelId}>
              {label}
            </h3>
          ) : (
            <div className={labelClass}>{label}</div>
          )}
          {description ? (
            <div className="text-[13px] text-muted-foreground leading-5">
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {action ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}

const LINK_ROW =
  "flex min-h-12 items-center justify-between gap-4 px-4 py-2.5 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50";

/** A row that opens another page; external links open in a new tab. */
export function SettingsLinkRow({
  description,
  external = false,
  href,
  icon,
  label,
  value,
  ...props
}: {
  description?: ReactNode;
  external?: boolean;
  href: string;
  icon?: ReactNode;
  label: ReactNode;
  value?: ReactNode;
} & Omit<ComponentProps<"a">, "href">) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-5">{label}</span>
          {description ? (
            <span className="block break-words text-[13px] text-muted-foreground leading-5">
              {description}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-sm">
        {value}
        {external ? (
          <ArrowUpRight className="size-3.5" />
        ) : (
          <ChevronRight className="size-4 opacity-70" />
        )}
      </span>
    </>
  );
  if (external) {
    return (
      <a
        className={LINK_ROW}
        href={href}
        rel="noopener"
        target="_blank"
        {...props}
      >
        {body}
      </a>
    );
  }
  return (
    <Link className={LINK_ROW} href={href} {...props}>
      {body}
    </Link>
  );
}

interface SettingsSectionProps {
  action?: ReactNode;
  /** Extra rows, or a padded body below the title row. */
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  /** Children fill the card edge to edge (rows and lists bring their own padding). */
  flush?: boolean;
  footer?: ReactNode;
  icon?: ReactNode;
  id: string;
  /**
   * `row`: the title is the card's first row, its action on the right.
   * `list`: the title is a caption above a card of rows.
   */
  layout?: "row" | "list";
  title?: string;
  tone?: "default" | "destructive";
}

export function SettingsSection({
  action,
  children,
  className,
  description,
  flush = false,
  footer,
  icon,
  id,
  layout = "row",
  title,
  tone = "default",
}: SettingsSectionProps) {
  const titleId = `${id}-title`;
  let body: ReactNode = null;
  if (children) {
    body =
      flush || layout === "list" ? (
        children
      ) : (
        <div className="px-4 py-3">{children}</div>
      );
  }
  const foot = footer ? (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      {footer}
    </div>
  ) : null;
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        "scroll-mt-20",
        layout === "list" && "space-y-2",
        className
      )}
      data-slot="settings-section"
      id={id}
    >
      {layout === "list" ? (
        <>
          {title || action ? (
            <SettingsCaption action={action} id={titleId} title={title} />
          ) : null}
          <SettingsGroup>
            {body}
            {foot}
          </SettingsGroup>
        </>
      ) : (
        <SettingsGroup>
          {title ? (
            <SettingsRow
              action={action}
              description={description}
              icon={icon}
              label={title}
              labelId={titleId}
              tone={tone}
            />
          ) : null}
          {body}
          {foot}
        </SettingsGroup>
      )}
    </section>
  );
}

export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-7">{children}</div>;
}
