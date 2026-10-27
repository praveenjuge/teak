"use client";

import { api } from "@teak/convex";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Combine,
  Ellipsis,
  Hash,
  Pencil,
  Search,
  Trash,
} from "vadivam-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  TagManagerDialog,
  type TagManagerMode,
} from "../components/modals/TagManagerDialog";
import { searchFieldClassName } from "../components/search/SearchBar";
import type { SidebarLinkComponent } from "../components/sidebar/AppSidebar";
import { useTagOperations } from "../hooks/useTagOperations";
import { LIBRARY_VIEW_PATHS } from "../lib/libraryViews";
import {
  applyTagOperationToSummary,
  type TagSummaryItem,
  tagKey,
} from "../lib/tags";
import { PageHeader, PageTitle } from "./PageHeader";

export type TagSort = "count" | "name";

const TAG_PAGE_SIZE = 150;
const SUMMARY_RETRY_MS = 5000;
const SKELETON_WIDTHS = ["42%", "28%", "56%", "34%", "48%", "24%"];
const SORT_LABELS = {
  count: "sortMostUsed",
  name: "sortName",
} as const satisfies Record<TagSort, string>;

const libraryTagHref = (name: string) =>
  `${LIBRARY_VIEW_PATHS.all}?${new URLSearchParams({ tag: name })}`;

export interface TagsScreenProps {
  headerLeading?: ReactNode;
  LinkComponent: SidebarLinkComponent;
  tagHref?: (name: string) => string;
}

interface TagRowProps {
  href: string;
  isMenuOpen: boolean;
  item: TagSummaryItem;
  LinkComponent: SidebarLinkComponent;
  onAction: (mode: TagManagerMode, item: TagSummaryItem) => void;
  onMenuOpenChange: (name: string | null) => void;
}

const TagRow = memo(function TagRow({
  href,
  isMenuOpen,
  item,
  LinkComponent,
  onAction,
  onMenuOpenChange,
}: TagRowProps) {
  const t = useTranslations("screens.tags");
  const intlLocale = useIntlLocale();
  const trigger = (
    <Button
      aria-label={t("moreFor", { tag: item.name })}
      className={cn(
        "mr-2 size-8 shrink-0 text-muted-foreground transition-opacity hover:text-foreground",
        "md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:focus-visible:opacity-100",
        isMenuOpen && "md:opacity-100"
      )}
      onClick={isMenuOpen ? undefined : () => onMenuOpenChange(item.name)}
      size="icon"
      type="button"
      variant="ghost"
    >
      <Ellipsis className="size-4" />
    </Button>
  );
  return (
    <li
      className={cn(
        "group/row flex items-center rounded-xl border bg-card transition-colors hover:bg-muted/40",
        isMenuOpen && "bg-muted/40"
      )}
    >
      <LinkComponent
        aria-label={t("rowLabel", { tag: item.name, count: item.count })}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        href={href}
      >
        <Hash
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground opacity-60"
        />
        <span className="truncate font-medium text-sm" dir="auto">
          {item.name}
        </span>
        <span className="ml-auto shrink-0 pl-3 text-muted-foreground text-sm tabular-nums">
          {item.count.toLocaleString(intlLocale)}
        </span>
      </LinkComponent>
      {isMenuOpen ? (
        <DropdownMenu
          onOpenChange={(open) => onMenuOpenChange(open ? item.name : null)}
          open
        >
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => onAction("rename", item)}>
              <Pencil />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("merge", item)}>
              <Combine />
              {t("mergeInto")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onAction("delete", item)}
              variant="destructive"
            >
              <Trash />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        trigger
      )}
    </li>
  );
});

function TagSortMenu({
  onSortChange,
  sort,
}: {
  onSortChange: (sort: TagSort) => void;
  sort: TagSort;
}) {
  const t = useTranslations("screens.tags");
  const Icon = sort === "name" ? ArrowDownAZ : ArrowDownWideNarrow;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("sortLabel", { sort: t(SORT_LABELS[sort]) })}
          className="h-9 shrink-0 gap-1.5 px-2.5 font-normal text-muted-foreground hover:text-foreground max-sm:w-9 max-sm:px-0"
          type="button"
          variant="ghost"
        >
          <Icon
            className={cn(
              "size-4 transition-colors duration-150",
              sort === "name" && "text-primary"
            )}
          />
          <span aria-hidden="true" className="max-sm:hidden">
            {t("sortLabel", { sort: t(SORT_LABELS[sort]) })}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
          {t("sortBy")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => onSortChange(value as TagSort)}
          value={sort}
        >
          <DropdownMenuRadioItem value="count">
            {t(SORT_LABELS.count)}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">
            {t(SORT_LABELS.name)}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TagsScreen({
  headerLeading,
  LinkComponent,
  tagHref = libraryTagHref,
}: TagsScreenProps) {
  const t = useTranslations("screens.tags");
  const intlLocale = useIntlLocale();
  const summary = useQuery(api.tags.listTagSummary, {});
  const requestSummary = useMutation(api.tags.requestTagSummary);
  const { latest, start } = useTagOperations();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TagSort>("count");
  const [limit, setLimit] = useState(TAG_PAGE_SIZE);
  const [menuTag, setMenuTag] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    mode: TagManagerMode;
    tag: TagSummaryItem;
    target?: string;
  } | null>(null);

  const [request, setRequest] = useState<"idle" | "pending" | "failed">("idle");
  useEffect(() => {
    if (summary !== null || request !== "idle") {
      return;
    }
    setRequest("pending");
    requestSummary({}).catch(() => setRequest("failed"));
  }, [request, requestSummary, summary]);
  useEffect(() => {
    if (request !== "failed") {
      return;
    }
    const retry = setTimeout(() => setRequest("idle"), SUMMARY_RETRY_MS);
    return () => clearTimeout(retry);
  }, [request]);

  const items = useMemo(
    () =>
      summary ? applyTagOperationToSummary(summary.items, latest) : undefined,
    [latest, summary]
  );
  const sorted = useMemo(
    () =>
      items && sort === "name"
        ? [...items].sort((left, right) => left.name.localeCompare(right.name))
        : items,
    [items, sort]
  );
  const needle = tagKey(query);
  const matches = useMemo(
    () =>
      needle && sorted
        ? sorted.filter((item) => item.name.includes(needle))
        : sorted,
    [needle, sorted]
  );

  const visible = matches?.slice(0, limit) ?? [];
  const remaining = matches ? matches.length - visible.length : 0;

  const openAction = (mode: TagManagerMode, tag: TagSummaryItem) => {
    setMenuTag(null);
    setDialog({ mode, tag });
  };

  let count: ReactNode;
  if (items && matches && (needle || items.length > 0)) {
    let figure = items.length.toLocaleString(intlLocale);
    if (needle) {
      figure = t("matchCount", {
        matches: matches.length,
        total: items.length,
      });
    } else if (summary && !summary.isComplete) {
      figure = t("topCount", { total: items.length });
    }
    count = (
      <>
        {figure}
        <span className="sr-only">{t("tagsSuffix")}</span>
      </>
    );
  }

  return (
    <div className="w-full pb-16">
      <PageHeader
        actions={
          <TagSortMenu
            onSortChange={(next) => {
              setSort(next);
              setLimit(TAG_PAGE_SIZE);
            }}
            sort={sort}
          />
        }
        leading={headerLeading}
        title={<PageTitle count={count}>{t("title")}</PageTitle>}
      >
        <form
          aria-label={t("findTag")}
          className="min-w-0 max-w-44 flex-1 sm:max-w-none"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className={searchFieldClassName}>
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground group-focus-within/search:text-foreground"
            />
            <Input
              aria-keyshortcuts="/"
              aria-label={t("findTag")}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0.5 text-sm shadow-none focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent [&::-webkit-search-cancel-button]:hidden"
              data-library-search=""
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(TAG_PAGE_SIZE);
              }}
              placeholder={t("findTag")}
              type="search"
              value={query}
            />
          </div>
        </form>
      </PageHeader>

      <div>
        {matches === undefined && (
          <ul
            aria-label={t("loading")}
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {SKELETON_WIDTHS.map((width) => (
              <li
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5"
                key={width}
              >
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4" style={{ width }} />
                <Skeleton className="ml-auto h-4 w-8" />
              </li>
            ))}
          </ul>
        )}

        {items?.length === 0 && (
          <div className="flex flex-col items-center rounded-xl border bg-card px-6 py-16 text-center">
            <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted">
              <Hash className="size-5 text-muted-foreground" />
            </div>
            <p className="font-medium">{t("noTags")}</p>
            <p className="mt-1 max-w-xs text-muted-foreground text-sm">
              {t("noTagsDescription")}
            </p>
          </div>
        )}

        {items && items.length > 0 && matches?.length === 0 && (
          <div className="rounded-xl border bg-card px-6 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {t("noMatches", { query: query.trim() })}
            </p>
          </div>
        )}

        {visible.length > 0 && (
          <ul
            aria-label={t("list")}
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {visible.map((item) => (
              <TagRow
                href={tagHref(item.name)}
                isMenuOpen={menuTag === item.name}
                item={item}
                key={item.name}
                LinkComponent={LinkComponent}
                onAction={openAction}
                onMenuOpenChange={setMenuTag}
              />
            ))}
          </ul>
        )}

        {remaining > 0 && (
          <div className="mt-4 flex justify-center">
            <Button
              className="text-muted-foreground"
              onClick={() => setLimit((value) => value + TAG_PAGE_SIZE)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("showMore", { count: Math.min(remaining, TAG_PAGE_SIZE) })}
            </Button>
          </div>
        )}
      </div>

      <TagManagerDialog
        initialTarget={dialog?.target}
        mode={dialog?.mode ?? null}
        onModeChange={(mode, target) =>
          setDialog((current) =>
            current ? { ...current, mode, target } : current
          )
        }
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        onStart={start}
        open={dialog !== null}
        tag={dialog?.tag ?? null}
        tags={items ?? []}
      />
    </div>
  );
}
