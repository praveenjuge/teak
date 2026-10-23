import type { TimeFilter } from "@teak/convex/shared";
import {
  CARD_TYPE_LABELS,
  type CardType,
  COLOR_HUE_LABELS,
  type ColorHueBucket,
  getCardTypeIcon,
  VISUAL_STYLE_LABELS,
  type VisualStyle,
} from "@teak/convex/shared/constants";
import {
  Aperture,
  Archive,
  Banknote,
  Circle,
  CircleCheck,
  CircleSlash,
  Clock,
  Droplets,
  File,
  FileText,
  Folder,
  Globe,
  Hash,
  Image,
  Link as LinkIcon,
  ListFilter,
  Palette,
  Parentheses,
  Quote,
  ScanText,
  Search,
  Sparkles,
  Split,
  Star,
  Tag,
  Video,
  Volume2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { isImeComposing } from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
import {
  type LibrarySort,
  MAX_URL_SEARCH_LENGTH,
} from "../../lib/searchUrlState";
import { PageHeader } from "../../screens/PageHeader";
import {
  buildSearchSuggestions,
  continuesOperator,
  currentSearchToken,
  describeKeywordChip,
  describeQualifierChip,
  type SearchSuggestion,
  type SearchSuggestionSources,
} from "./searchSuggestions";
import { ReshuffleButton, ViewMenu } from "./ViewMenu";

export interface SearchBarProps {
  canSortByRelevance?: boolean;
  filterTags: CardType[];
  HeaderActions?: ReactNode;
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  leading?: ReactNode;
  lockedChips?: ReactNode;
  onActivate?: () => void;
  onAddQualifier?: (qualifier: string) => void;
  onClearAll: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveFilter: (filter: CardType) => void;
  onRemoveHexFilter: (hex: string) => void;
  onRemoveHueFilter: (hue: ColorHueBucket) => void;
  onRemoveKeyword: (keyword: string) => void;
  onRemoveQualifier?: (qualifier: string) => void;
  onRemoveStyleFilter: (style: VisualStyle) => void;
  onRemoveTagFilter?: () => void;
  onRemoveTimeFilter: () => void;
  onReshuffle?: () => void;
  onSaveSearch?: () => void;
  onSearchChange: (value: string) => void;
  onSortChange?: (sort: LibrarySort) => void;
  onToggleFilter?: (filter: CardType) => void;
  placeholder?: string;
  qualifierChips?: string[];
  revisit?: "empty" | "ready";
  searchQuery: string;
  similarAnchorTitle?: string;
  sort?: LibrarySort;
  styleFilters: VisualStyle[];
  suggestionSources?: SearchSuggestionSources;
  tagFilter?: string;
  timeFilter?: TimeFilter | null;
  title?: ReactNode;
}

const iconComponentMap = {
  FileText,
  Link: LinkIcon,
  Image,
  Video,
  Volume2,
  File,
  Palette,
  Quote,
} as const;

export const getFilterIcon = (filter: CardType) => {
  const iconName = getCardTypeIcon(filter) as keyof typeof iconComponentMap;
  return iconComponentMap[iconName] || FileText;
};

function preventBlur(e: React.MouseEvent) {
  e.preventDefault();
}

export const QUALIFIER_ICONS = {
  tag: Tag,
  site: Globe,
  folder: Folder,
  type: ListFilter,
  is: Star,
  like: Sparkles,
  mood: Aperture,
  price: Banknote,
  text: ScanText,
} as const;

const IS_ICONS: Partial<Record<string, typeof Tag>> = {
  archived: Archive,
  done: CircleCheck,
  todo: Circle,
};

const suggestionIcon = (suggestion: SearchSuggestion) => {
  if (suggestion.type) {
    return getFilterIcon(suggestion.type);
  }
  if (suggestion.key === "OR") {
    return Split;
  }
  if (suggestion.key === "is") {
    return IS_ICONS[suggestion.insert.replace(/^-?is:/, "")] ?? Star;
  }
  return QUALIFIER_ICONS[suggestion.key];
};

const MAX_INLINE_CHIPS = 3;

export const searchFieldClassName =
  "group/search flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg bg-muted/60 pr-1.5 pl-2.5 ring-1 ring-transparent transition-[background-color,box-shadow] duration-150 hover:bg-muted focus-within:bg-background focus-within:shadow-sm focus-within:ring-border dark:bg-muted/40";

interface FilterChip {
  ariaLabel: string;
  dashed?: boolean;
  /** Leaves these cards out: a leading minus and a muted label. */
  excluded?: boolean;
  icon: ReactNode;
  key: string;
  label: string;
  onRemove: () => void;
  prefix?: string;
}

function FilterChipButton({ chip }: { chip: FilterChip }) {
  return (
    <button
      aria-label={chip.ariaLabel}
      className={cn(
        "inline-flex h-6 min-w-0 max-w-44 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
        chip.dashed
          ? "border border-dashed text-muted-foreground"
          : "bg-background text-foreground shadow-xs ring-1 ring-border/70 hover:bg-accent"
      )}
      onClick={chip.onRemove}
      onMouseDown={preventBlur}
      title={[chip.prefix, chip.excluded ? "not" : null, chip.label]
        .filter(Boolean)
        .join(" ")}
      type="button"
    >
      {chip.icon}
      {chip.prefix ? (
        <span className="shrink-0 text-muted-foreground">{chip.prefix}</span>
      ) : null}
      {chip.excluded ? (
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          −
        </span>
      ) : null}
      <span
        className={cn("truncate", chip.excluded && "text-muted-foreground")}
        dir="auto"
      >
        {chip.label}
      </span>
      <X aria-hidden="true" className="opacity-50" />
    </button>
  );
}

// Declarative WebMCP attributes (draft spec:
// https://webmachinelearning.github.io/webmcp/); browsers without WebMCP
// ignore them. WebMCP rejects duplicate tool names, so this one must differ
// from the imperative tools in apps/web.
const webMcpSearchAttributes = {
  toolname: "teak_search_form",
  tooldescription:
    "Fill the Teak search box with a keyword query and submit it. Read-only; shows matching cards in the page.",
  toolautosubmit: "",
};

const webMcpQueryAttributes = {
  toolparamdescription: "Keyword query to filter the user's Teak cards.",
};

export function SearchBar({
  searchQuery,
  onSearchChange,
  onKeyDown,
  keywordTags,
  timeFilter,
  filterTags,
  styleFilters,
  hueFilters,
  hexFilters,
  onRemoveFilter,
  onRemoveStyleFilter,
  onRemoveHueFilter,
  onRemoveHexFilter,
  onRemoveKeyword,
  onRemoveTimeFilter,
  onRemoveTagFilter,
  tagFilter,
  qualifierChips = [],
  similarAnchorTitle,
  onActivate,
  onAddQualifier,
  onRemoveQualifier,
  suggestionSources,
  onClearAll,
  HeaderActions,
  leading,
  lockedChips,
  placeholder = "Search everything",
  sort = "newest",
  canSortByRelevance,
  revisit,
  onSaveSearch,
  onSortChange,
  onReshuffle,
  onToggleFilter,
  title,
}: SearchBarProps) {
  const hasAnyFilters =
    qualifierChips.length > 0 ||
    keywordTags.length > 0 ||
    Boolean(tagFilter) ||
    Boolean(timeFilter) ||
    filterTags.length > 0 ||
    styleFilters.length > 0 ||
    hueFilters.length > 0 ||
    hexFilters.length > 0;

  const listId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ index: number; query: string }>({
    index: -1,
    query: "",
  });
  const { start: tokenStart, token } = currentSearchToken(searchQuery);
  // OR is offered only after a word in the box: a pill can't be its left
  // side, since Enter turns the box into pills of its own.
  const afterWord = searchQuery.slice(0, tokenStart).trim() !== "";
  const { suggestions, completingValue } = useMemo(
    () =>
      onAddQualifier
        ? buildSearchSuggestions(token, suggestionSources ?? {}, { afterWord })
        : { suggestions: [], completingValue: false },
    [afterWord, onAddQualifier, suggestionSources, token]
  );
  const open =
    focused && dismissedFor !== searchQuery && suggestions.length > 0;
  let active = completingValue ? 0 : -1;
  if (picked.query === searchQuery) {
    active = picked.index;
  }
  const setActive = (index: number) => setPicked({ index, query: searchQuery });
  const folderNames = useMemo(
    () =>
      suggestionSources?.folders
        ? new Set(
            suggestionSources.folders.map((folder) =>
              folder.name.trim().toLowerCase()
            )
          )
        : undefined,
    [suggestionSources?.folders]
  );

  const accept = (suggestion: SearchSuggestion) => {
    const before = searchQuery.slice(0, tokenStart);
    if (suggestion.complete && continuesOperator(before)) {
      onSearchChange(`${before}${suggestion.insert} `);
    } else if (suggestion.complete) {
      onAddQualifier?.(suggestion.insert);
      onSearchChange(before.trimEnd());
    } else {
      onSearchChange(`${before}${suggestion.insert}`);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) {
      return;
    }
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const next = active + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) {
        setActive(suggestions.length - 1);
      } else {
        setActive(next >= suggestions.length ? 0 : next);
      }
      return;
    }
    if (!open && e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setDismissedFor(null);
      setActive(0);
      return;
    }
    if (open && e.key === "Enter" && active >= 0) {
      const suggestion = suggestions[active];
      if (suggestion) {
        e.preventDefault();
        accept(suggestion);
        return;
      }
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissedFor(searchQuery);
      return;
    }
    onKeyDown(e);
  };

  const groups: { name: string; items: SearchSuggestion[] }[] = [];
  for (const suggestion of suggestions) {
    const last = groups[groups.length - 1];
    if (last?.name === suggestion.group) {
      last.items.push(suggestion);
    } else {
      groups.push({ name: suggestion.group, items: [suggestion] });
    }
  }
  const optionId = (index: number) => `${listId}-option-${index}`;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = new FormData(e.currentTarget).get("q");
    if (typeof query === "string") {
      onSearchChange(query);
    }
  };

  const chips: FilterChip[] = [];
  if (tagFilter) {
    chips.push({
      ariaLabel: `Remove tag filter ${tagFilter}`,
      icon: <Tag />,
      key: "tag-filter",
      label: tagFilter,
      onRemove: () => onRemoveTagFilter?.(),
    });
  }
  for (const chip of qualifierChips) {
    const described = describeQualifierChip(chip, similarAnchorTitle);
    if (!described) {
      continue;
    }
    const { excluded, qualifier, label, title } = described;
    const unknownFolder =
      qualifier.key === "folder" &&
      folderNames !== undefined &&
      !folderNames.has(qualifier.value.trim().toLowerCase());
    let Icon: typeof Tag = QUALIFIER_ICONS[qualifier.key];
    if (qualifier.key === "type") {
      Icon = getFilterIcon(qualifier.value);
    } else if (qualifier.key === "is") {
      Icon = IS_ICONS[qualifier.value] ?? Star;
    } else if (unknownFolder) {
      Icon = CircleSlash;
    }
    let ariaLabel = `Remove ${title.toLowerCase()} ${label}`;
    if (unknownFolder) {
      ariaLabel = `Remove ${chip}: no folder named ${qualifier.value}`;
    } else if (excluded) {
      ariaLabel = `Remove excluding ${title.toLowerCase()} ${label}`;
    }
    chips.push({
      ariaLabel,
      dashed: unknownFolder,
      excluded,
      icon: <Icon />,
      key: `qualifier-${chip}`,
      label: unknownFolder ? `No folder named ${label}` : label,
      prefix: unknownFolder ? undefined : title,
      onRemove: () => onRemoveQualifier?.(chip),
    });
  }
  for (const keyword of keywordTags) {
    const { excluded, group, label } = describeKeywordChip(keyword);
    let icon = <Hash />;
    if (group) {
      icon = <Parentheses />;
    } else if (label.startsWith('"')) {
      icon = <Quote />;
    }
    chips.push({
      ariaLabel: excluded ? `Remove excluding ${label}` : `Remove ${label}`,
      excluded,
      icon,
      key: `keyword-${keyword}`,
      label,
      onRemove: () => onRemoveKeyword(keyword),
    });
  }
  if (timeFilter) {
    chips.push({
      ariaLabel: `Remove ${timeFilter.label}`,
      icon: <Clock />,
      key: "time-filter",
      label: timeFilter.label,
      onRemove: onRemoveTimeFilter,
    });
  }
  for (const filter of filterTags) {
    const Icon = getFilterIcon(filter);
    chips.push({
      ariaLabel: `Remove type ${CARD_TYPE_LABELS[filter]}`,
      icon: <Icon />,
      key: `filter-${filter}`,
      label: CARD_TYPE_LABELS[filter],
      onRemove: () => onRemoveFilter(filter),
    });
  }
  for (const style of styleFilters) {
    chips.push({
      ariaLabel: `Remove ${VISUAL_STYLE_LABELS[style]}`,
      icon: <Sparkles />,
      key: `style-${style}`,
      label: VISUAL_STYLE_LABELS[style],
      onRemove: () => onRemoveStyleFilter(style),
    });
  }
  for (const hue of hueFilters) {
    chips.push({
      ariaLabel: `Remove ${COLOR_HUE_LABELS[hue]}`,
      icon: <Droplets />,
      key: `hue-${hue}`,
      label: COLOR_HUE_LABELS[hue],
      onRemove: () => onRemoveHueFilter(hue),
    });
  }
  for (const hex of hexFilters) {
    chips.push({
      ariaLabel: `Remove ${hex}`,
      icon: (
        <span
          className="size-3 shrink-0 rounded-full border"
          style={{ backgroundColor: hex }}
        />
      ),
      key: `hex-${hex}`,
      label: hex,
      onRemove: () => onRemoveHexFilter(hex),
    });
  }
  const inlineChips = chips.slice(0, MAX_INLINE_CHIPS);
  const overflowChips = chips.slice(MAX_INLINE_CHIPS);
  const canClear = hasAnyFilters || searchQuery.length > 0;
  const fieldShown = mobileOpen || canClear;

  const clearAll = () => {
    onClearAll();
    onSearchChange("");
  };

  return (
    <PageHeader
      actions={
        <>
          <Button
            aria-label="Search"
            className={cn(
              "size-9 shrink-0 text-muted-foreground sm:hidden",
              fieldShown && "hidden"
            )}
            onClick={() => {
              setMobileOpen(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Search className="size-4" />
          </Button>
          {mobileOpen ? (
            <Button
              className="h-9 shrink-0 px-2 text-muted-foreground sm:hidden"
              onClick={() => {
                setMobileOpen(false);
                onSearchChange("");
              }}
              onMouseDown={preventBlur}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          ) : null}
          {onSortChange && onReshuffle && sort === "shuffle" && (
            <div className={cn(mobileOpen && "max-sm:hidden")}>
              <ReshuffleButton onReshuffle={onReshuffle} />
            </div>
          )}
          {onToggleFilter || onSortChange ? (
            <div className={cn(mobileOpen && "max-sm:hidden")}>
              <ViewMenu
                activeTypes={filterTags}
                canSortByRelevance={canSortByRelevance}
                onClearTypes={() => {
                  for (const filter of filterTags) {
                    onRemoveFilter(filter);
                  }
                }}
                onSaveSearch={onSaveSearch}
                onSortChange={onSortChange}
                onToggleType={onToggleFilter}
                revisit={revisit}
                sort={sort}
              />
            </div>
          ) : null}
          {HeaderActions}
        </>
      }
      leading={
        leading ? (
          <div className={cn("contents", mobileOpen && "max-sm:hidden")}>
            {leading}
          </div>
        ) : undefined
      }
      title={
        title ? (
          <div className={cn("contents", fieldShown && "max-sm:hidden")}>
            {title}
          </div>
        ) : undefined
      }
    >
      <form
        aria-label="Search cards"
        className={cn(
          "relative min-w-0 flex-1 sm:ml-auto sm:max-w-xl",
          !fieldShown && "max-sm:hidden"
        )}
        onSubmit={handleSubmit}
        {...webMcpSearchAttributes}
      >
        <label
          className={searchFieldClassName}
          data-search-field=""
          htmlFor={inputId}
        >
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground group-focus-within/search:text-foreground"
          />
          {lockedChips}
          {inlineChips.length > 0 && (
            <div className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
              {inlineChips.map((chip) => (
                <FilterChipButton chip={chip} key={chip.key} />
              ))}
            </div>
          )}
          {overflowChips.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`${overflowChips.length} more ${overflowChips.length === 1 ? "filter" : "filters"}`}
                  className="inline-flex h-6 shrink-0 items-center rounded-md bg-background px-1.5 font-medium text-muted-foreground text-xs shadow-xs ring-1 ring-border/70 hover:text-foreground"
                  onMouseDown={preventBlur}
                  type="button"
                >
                  +{overflowChips.length}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {overflowChips.map((chip) => (
                  <DropdownMenuItem
                    aria-label={chip.ariaLabel}
                    key={chip.key}
                    onSelect={chip.onRemove}
                  >
                    {chip.icon}
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {chip.prefix ? (
                        <span className="text-muted-foreground">
                          {chip.prefix}{" "}
                        </span>
                      ) : null}
                      {chip.excluded ? (
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground"
                        >
                          −
                        </span>
                      ) : null}
                      <span
                        className={cn(chip.excluded && "text-muted-foreground")}
                      >
                        {chip.label}
                      </span>
                    </span>
                    <X className="opacity-50" />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Input
            aria-activedescendant={
              open && active >= 0 ? optionId(active) : undefined
            }
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-expanded={open}
            aria-keyshortcuts="/"
            aria-label={placeholder}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="h-full min-w-20 flex-1 rounded-none border-0 bg-transparent px-0.5 text-sm shadow-none focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent [&::-webkit-search-cancel-button]:hidden"
            data-library-search=""
            id={inputId}
            maxLength={MAX_URL_SEARCH_LENGTH}
            name="q"
            onBlur={() => setFocused(false)}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => {
              setFocused(true);
              onActivate?.();
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="search"
            value={searchQuery}
            {...webMcpQueryAttributes}
          />
          {canClear ? (
            <button
              aria-label="Clear all"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={clearAll}
              onMouseDown={preventBlur}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            !focused && (
              <Kbd aria-hidden="true" className="max-sm:hidden">
                /
              </Kbd>
            )
          )}
        </label>

        {open ? (
          <div
            aria-label="Search suggestions"
            className="fade-in-0 zoom-in-95 absolute inset-x-0 top-full z-50 mt-1.5 max-h-80 animate-in overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-md duration-100"
            id={listId}
            role="listbox"
          >
            {groups.map((group) => (
              // biome-ignore lint/a11y/useSemanticElements: an ARIA listbox groups its options with role="group"
              <div aria-label={group.name} key={group.name} role="group">
                <div className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs">
                  {group.name}
                </div>
                {group.items.map((suggestion) => {
                  const index = suggestions.indexOf(suggestion);
                  const Icon = suggestionIcon(suggestion);
                  const isActive = index === active;
                  return (
                    // biome-ignore lint/a11y/useFocusableInteractive: combobox options stay unfocused; the input moves through them with aria-activedescendant
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keyboard (arrows and Enter) for every option
                    <div
                      aria-selected={isActive}
                      className={cn(
                        "flex min-h-9 cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                        isActive && "bg-accent text-accent-foreground"
                      )}
                      id={optionId(index)}
                      key={suggestion.id}
                      onClick={() => accept(suggestion)}
                      onMouseDown={preventBlur}
                      onMouseMove={() => setActive(index)}
                      role="option"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          !suggestion.complete && "font-mono text-[13px]"
                        )}
                        dir="auto"
                      >
                        {suggestion.label}
                      </span>
                      {suggestion.detail ? (
                        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {suggestion.detail}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </form>
    </PageHeader>
  );
}
