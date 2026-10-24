import {
  formatSearchQualifier,
  parseSearchQuery,
  type SearchQualifier,
  searchExpressionParts,
} from "@teak/convex/shared";
import { useTranslations } from "@teak/i18n/react";
import { Archive, CircleSlash, Parentheses, Quote, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { getFilterIcon, QUALIFIER_ICONS } from "../search/SearchBar";
import {
  describeKeywordChip,
  describeQualifierChip,
} from "../search/searchSuggestions";

interface SmartFolderQueryProps {
  className?: string;
  folderNames?: ReadonlySet<string>;
  inline?: boolean;
  query: string;
}

function QueryChip({
  children,
  dashed = false,
}: {
  children: ReactNode;
  dashed?: boolean;
}) {
  return (
    <li
      className={cn(
        "inline-flex h-6 max-w-[min(18rem,100%)] shrink-0 items-center gap-1 rounded-md px-2 text-xs",
        "in-data-[inline]:max-w-40 in-data-[inline]:px-1.5",
        dashed
          ? "border border-dashed text-muted-foreground"
          : "bg-secondary in-data-[inline]:bg-foreground/[0.06] in-data-[inline]:text-muted-foreground text-secondary-foreground"
      )}
    >
      {children}
    </li>
  );
}

function ExcludedLabel({ label }: { label: string }) {
  const t = useTranslations("folders.smartQuery");
  return (
    <>
      <span aria-hidden="true" className="shrink-0">
        {"−"}
      </span>
      <span className="sr-only">{t("excluded")}</span>
      <span className="truncate text-muted-foreground" dir="auto">
        {label}
      </span>
    </>
  );
}

export function SmartFolderQuery({
  className,
  folderNames,
  inline = false,
  query,
}: SmartFolderQueryProps) {
  const t = useTranslations("folders.smartQuery");
  const parsed = parseSearchQuery(query);
  const qualifierChip = (qualifier: SearchQualifier, excluded = false) => {
    const chip = formatSearchQualifier(qualifier);
    const described = describeQualifierChip(chip);
    const { label, title } = described ?? { label: qualifier.value, title: "" };
    const unknownFolder =
      qualifier.key === "folder" &&
      folderNames !== undefined &&
      !folderNames.has(qualifier.value.trim().toLowerCase());
    let Icon = QUALIFIER_ICONS[qualifier.key] as typeof Search;
    if (qualifier.key === "type") {
      Icon = getFilterIcon(qualifier.value);
    } else if (qualifier.key === "is" && qualifier.value === "archived") {
      Icon = Archive;
    } else if (unknownFolder) {
      Icon = CircleSlash;
    }
    return (
      <QueryChip dashed={unknownFolder} key={`${excluded ? "-" : ""}q:${chip}`}>
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        {unknownFolder ? (
          <span className="truncate" dir="auto">
            {t("noFolderNamed", { name: qualifier.value })}
          </span>
        ) : (
          <>
            <span className="shrink-0 text-muted-foreground">{title}</span>
            {excluded ? <ExcludedLabel label={label} /> : null}
            {excluded ? null : (
              <span className="truncate" dir="auto">
                {label}
              </span>
            )}
          </>
        )}
      </QueryChip>
    );
  };
  const chips: ReactNode[] = parsed.qualifiers.map((qualifier) =>
    qualifierChip(qualifier)
  );
  for (const phrase of parsed.phrases) {
    chips.push(
      <QueryChip key={`p:${phrase}`}>
        <Quote aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate" dir="auto">
          {phrase}
        </span>
      </QueryChip>
    );
  }
  if (parsed.terms.length > 0) {
    const words = parsed.terms.join(" ");
    chips.push(
      <QueryChip key={`t:${words}`}>
        <Search aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate" dir="auto">
          {words}
        </span>
      </QueryChip>
    );
  }
  for (const part of searchExpressionParts(parsed)) {
    const { expression } = parseSearchQuery(part);
    if (expression?.op === "not" && expression.item.op === "qualifier") {
      chips.push(qualifierChip(expression.item.qualifier, true));
      continue;
    }
    const { excluded, group, label } = describeKeywordChip(part);
    const Icon = group ? Parentheses : Search;
    chips.push(
      <QueryChip key={`e:${part}`}>
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        {excluded ? (
          <ExcludedLabel label={label} />
        ) : (
          <span className="truncate" dir="auto">
            {label}
          </span>
        )}
      </QueryChip>
    );
  }
  return (
    <ul
      aria-label={t("label", { query })}
      className={cn(
        inline
          ? "flex min-w-0 flex-nowrap gap-1 overflow-hidden"
          : "flex max-h-[3.375rem] flex-wrap gap-1.5 overflow-hidden",
        className
      )}
      data-inline={inline || undefined}
      title={query}
    >
      {chips}
    </ul>
  );
}
