"use client";

import { api } from "@teak/convex";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import { Input } from "@teak/ui/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@teak/ui/components/ui/sidebar";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import {
  ChevronDown,
  ChevronUp,
  Combine,
  Hash,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import {
  type StartTagOperationInput,
  useTagOperations,
} from "../../hooks/useTagOperations";
import {
  applyTagOperationToSummary,
  TAG_SIDEBAR_PREVIEW_COUNT,
  type TagSummaryItem,
  tagKey,
} from "../../lib/tags";
import {
  TagManagerDialog,
  type TagManagerMode,
} from "../modals/TagManagerDialog";

const SKELETON_WIDTHS = ["58%", "44%", "66%"];
/** How long to wait before asking for a first tag snapshot again. */
const SUMMARY_RETRY_MS = 5000;
/** With more tags than this, "Show all" adds a box to find one. */
const TAG_FILTER_THRESHOLD = 12;

interface SidebarTagsProps {
  /** The tag narrowing the library, lowercased; empty for none. */
  activeTag: string;
  /** Picks a tag, or clears it when it is the active one. */
  onSelectTag: (tag: string) => void;
}

interface TagRowProps {
  isActive: boolean;
  isMenuOpen: boolean;
  item: TagSummaryItem;
  menuAlign: "start" | "end";
  menuSide: "right" | "bottom";
  onAction: (mode: TagManagerMode, item: TagSummaryItem) => void;
  onMenuOpenChange: (name: string | null) => void;
  onSelect: (name: string) => void;
}

/** One tag: pick it to filter, or open its menu to change it everywhere. */
const TagRow = memo(function TagRow({
  item,
  isActive,
  isMenuOpen,
  menuAlign,
  menuSide,
  onAction,
  onMenuOpenChange,
  onSelect,
}: TagRowProps) {
  const action = (
    <SidebarMenuAction
      aria-label={`More for ${item.name}`}
      onClick={isMenuOpen ? undefined : () => onMenuOpenChange(item.name)}
      showOnHover
    >
      <MoreHorizontal />
    </SidebarMenuAction>
  );
  return (
    <SidebarMenuItem
      onContextMenu={(event) => {
        event.preventDefault();
        onMenuOpenChange(item.name);
      }}
    >
      <SidebarMenuButton
        aria-pressed={isActive}
        isActive={isActive}
        onClick={() => onSelect(item.name)}
      >
        <Hash className="text-sidebar-foreground/60" />
        <span dir="auto" title={item.name}>
          {item.name}
        </span>
      </SidebarMenuButton>
      <SidebarMenuBadge className="text-sidebar-foreground/55 transition-opacity group-has-data-[state=open]/menu-item:opacity-0 max-md:right-8 md:group-hover/menu-item:opacity-0 md:group-focus-within/menu-item:opacity-0">
        {item.count.toLocaleString()}
      </SidebarMenuBadge>
      {/* The menu mounts only while open, so thousands of tags stay light. */}
      {isMenuOpen ? (
        <DropdownMenu
          onOpenChange={(open) => onMenuOpenChange(open ? item.name : null)}
          open
        >
          <DropdownMenuTrigger asChild>{action}</DropdownMenuTrigger>
          <DropdownMenuContent
            align={menuAlign}
            className="w-48"
            side={menuSide}
          >
            <DropdownMenuItem onSelect={() => onAction("rename", item)}>
              <Pencil />
              Rename…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("merge", item)}>
              <Combine />
              Merge into…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onAction("delete", item)}
              variant="destructive"
            >
              <Trash2 />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        action
      )}
    </SidebarMenuItem>
  );
});

/**
 * The Tags group in the sidebar: tags on cards outside Trash and Archive,
 * most-used first, with their counts. Picking one filters the library; its
 * menu renames, merges or deletes it on every card.
 */
export function SidebarTags({ activeTag, onSelectTag }: SidebarTagsProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const summary = useQuery(api.tags.listTagSummary, {});
  const requestSummary = useMutation(api.tags.requestTagSummary);
  const { latest, start } = useTagOperations();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [menuTag, setMenuTag] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    mode: TagManagerMode;
    open: boolean;
    tag: TagSummaryItem;
    target?: string;
  } | null>(null);

  // No snapshot yet (a first visit): ask for one, and ask again a little
  // later if the request fails.
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

  const visible = useMemo(() => {
    if (!items) {
      return [];
    }
    if (expanded) {
      const needle = filter.trim().toLowerCase();
      return needle
        ? items.filter((item) => item.name.includes(needle))
        : items;
    }
    const preview = items.slice(0, TAG_SIDEBAR_PREVIEW_COUNT);
    // The tag filtering the library stays in view even when it is rarely used.
    const active = activeTag
      ? items.find((item) => item.name === activeTag)
      : undefined;
    return active && !preview.includes(active) ? [...preview, active] : preview;
  }, [activeTag, expanded, filter, items]);

  const select = (name: string) => {
    onSelectTag(name);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const openAction = (mode: TagManagerMode, tag: TagSummaryItem) => {
    setMenuTag(null);
    setDialog({ mode, open: true, tag });
  };

  // A change to the tag filtering the library moves the filter along.
  const startOperation = async (input: StartTagOperationInput) => {
    const started = await start(input);
    if (activeTag && tagKey(input.from) === activeTag) {
      if (input.kind === "delete") {
        onSelectTag(activeTag);
      } else if (input.to && tagKey(input.to) !== activeTag) {
        onSelectTag(tagKey(input.to));
      }
    }
    return started;
  };

  const hiddenCount = items ? items.length - TAG_SIDEBAR_PREVIEW_COUNT : 0;

  return (
    // Tags read as words, so the icon rail leaves them out.
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Tags</SidebarGroupLabel>
      {expanded && items && items.length > TAG_FILTER_THRESHOLD && (
        <div className="relative mb-1 px-0.5">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-sidebar-foreground/50"
          />
          <Input
            aria-label="Find a tag"
            className="h-8 bg-sidebar pl-7 text-sm shadow-none"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find a tag"
            value={filter}
          />
        </div>
      )}
      <div
        className={
          expanded
            ? "max-h-[50vh] overflow-y-auto overscroll-contain"
            : undefined
        }
      >
        <SidebarMenu>
          {items === undefined &&
            SKELETON_WIDTHS.map((width) => (
              <SidebarMenuItem key={width}>
                <SidebarMenuSkeleton showIcon width={width} />
              </SidebarMenuItem>
            ))}
          {items?.length === 0 && (
            <SidebarMenuItem>
              <p className="px-2 py-1.5 text-sidebar-foreground/60 text-sm">
                No tags yet.
              </p>
            </SidebarMenuItem>
          )}
          {expanded && items && items.length > 0 && visible.length === 0 && (
            <SidebarMenuItem>
              <p className="px-2 py-1.5 text-sidebar-foreground/60 text-sm">
                No tag by that name.
              </p>
            </SidebarMenuItem>
          )}
          {visible.map((item) => (
            <TagRow
              isActive={item.name === activeTag}
              isMenuOpen={menuTag === item.name}
              item={item}
              key={item.name}
              menuAlign={isMobile ? "end" : "start"}
              menuSide={isMobile ? "bottom" : "right"}
              onAction={openAction}
              onMenuOpenChange={setMenuTag}
              onSelect={select}
            />
          ))}
        </SidebarMenu>
      </div>
      {hiddenCount > 0 && (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="text-sidebar-foreground/70"
              onClick={() => {
                setExpanded((value) => !value);
                setFilter("");
              }}
              size="sm"
            >
              {expanded ? <ChevronUp /> : <ChevronDown />}
              <span>
                {expanded
                  ? "Show fewer"
                  : `Show all ${items?.length.toLocaleString()} tags`}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
      {summary && !summary.isComplete && (
        <p className="px-2 pt-1 text-sidebar-foreground/55 text-xs">
          Showing your most-used tags.
        </p>
      )}
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
            setDialog((current) =>
              current ? { ...current, open: false } : current
            );
          }
        }}
        onStart={startOperation}
        open={dialog?.open ?? false}
        tag={dialog?.tag ?? null}
        tags={items ?? []}
      />
    </SidebarGroup>
  );
}
