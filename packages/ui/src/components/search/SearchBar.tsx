import type { CardListSort, TimeFilter } from "@teak/convex/shared";
import {
  CARD_TYPE_LABELS,
  type CardType,
  COLOR_HUE_LABELS,
  type ColorHueBucket,
  getCardTypeIcon,
  VISUAL_STYLE_LABELS,
  type VisualStyle,
} from "@teak/convex/shared/constants";
import { Button } from "@teak/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import { Input } from "@teak/ui/components/ui/input";
import { Kbd } from "@teak/ui/components/ui/kbd";
import { cn } from "@teak/ui/lib/utils";
import {
  Archive,
  Banknote,
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
  Quote,
  Search,
  Sparkles,
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
import { PageHeader } from "../../screens/PageHeader";
import {
  buildSearchSuggestions,
  currentSearchToken,
  describeQualifierChip,
  type SearchSuggestion,
  type SearchSuggestionSources,
} from "./searchSuggestions";
import { ReshuffleButton, ViewMenu } from "./ViewMenu";

export interface SearchBarProps {
  filterTags: CardType[];
  /** Controls at the end of the bar, such as the sort menu. */
  HeaderActions?: ReactNode;
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  /** Shown first in the header, such as the sidebar toggle. */
  leading?: ReactNode;
  /**
   * Read-only chips at the start of the field, such as a smart folder's own
   * search, which the typed search narrows further.
   */
  lockedChips?: ReactNode;
  /** Called when the search box is first focused, to load suggestions. */
  onActivate?: () => void;
  /** Turns a picked suggestion (`site:github.com`) into a chip. */
  onAddQualifier?: (qualifier: string) => void;
  onClearAll: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveFilter: (filter: CardType) => void;
  onRemoveHexFilter: (hex: string) => void;
  onRemoveHueFilter: (hue: ColorHueBucket) => void;
  onRemoveKeyword: (keyword: string) => void;
  onRemoveQualifier?: (qualifier: string) => void;
  onRemoveStyleFilter: (style: VisualStyle) => void;
  /** Clears the sidebar tag; shown when `tagFilter` is set. */
  onRemoveTagFilter?: () => void;
  onRemoveTimeFilter: () => void;
  /** Shuffles again; shown beside the View menu while the sort is Shuffle. */
  onReshuffle?: () => void;
  /**
   * Saves what is on screen as a smart folder; offered in the sort menu
   * while set (there is a search to save).
   */
  onSaveSearch?: () => void;
  onSearchChange: (value: string) => void;
  /** Shows the sort menu when set. */
  onSortChange?: (sort: CardListSort) => void;
  /** Shows the card type filter when set. */
  onToggleFilter?: (filter: CardType) => void;
  placeholder?: string;
  /** Accepted qualifiers, each a removable chip. */
  qualifierChips?: string[];
  searchQuery: string;
  sort?: CardListSort;
  styleFilters: VisualStyle[];
  /**
   * Tags, folders and sites to suggest while typing. Leave the lists
   * undefined while they load; a missing folder list also keeps `folder:`
   * chips from reading as unknown.
   */
  suggestionSources?: SearchSuggestionSources;
  /** A tag picked in the sidebar, shown as a removable chip. */
  tagFilter?: string;
  timeFilter?: TimeFilter | null;
  /** The page's name at the start of the header (a PageTitle). */
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
  price: Banknote,
} as const;

const suggestionIcon = (suggestion: SearchSuggestion) => {
  if (suggestion.type) {
    return getFilterIcon(suggestion.type);
  }
  if (suggestion.key === "is" && suggestion.insert === "is:archived") {
    return Archive;
  }
  return QUALIFIER_ICONS[suggestion.key];
};

/** How many filter chips sit in the field before the rest fold into "+N". */
const MAX_INLINE_CHIPS = 3;

/** The search box: a soft, rounded field that lifts a little on focus. */
export const searchFieldClassName =
  "group/search flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg bg-muted/60 pr-1.5 pl-2.5 ring-1 ring-transparent transition-[background-color,box-shadow] duration-150 hover:bg-muted focus-within:bg-background focus-within:shadow-sm focus-within:ring-border dark:bg-muted/40";

interface FilterChip {
  ariaLabel: string;
  /** A folder the search names that doesn't exist. */
  dashed?: boolean;
  icon: ReactNode;
  key: string;
  label: string;
  onRemove: () => void;
  /** Muted text before the label, such as "Site". */
  prefix?: string;
}

/** One filter in the field: click to remove it. */
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
      title={chip.prefix ? `${chip.prefix} ${chip.label}` : chip.label}
      type="button"
    >
      {chip.icon}
      {chip.prefix && (
        <span className="shrink-0 text-muted-foreground">{chip.prefix}</span>
      )}
      <span className="truncate" dir="auto">
        {chip.label}
      </span>
      <X aria-hidden="true" className="opacity-50" />
    </button>
  );
}

// Declarative WebMCP attributes (draft spec:
// https://webmachinelearning.github.io/webmcp/). Browsers without WebMCP
// ignore them. Spread keeps the non-standard attributes past the JSX types.
// The name must stay distinct from the imperative tools in apps/web: WebMCP
// rejects duplicate tool names. toolautosubmit lets agent fills submit
// without a submit button, which this search box has no room for.
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
  onSaveSearch,
  onSortChange,
  onReshuffle,
  onToggleFilter,
  title,
}: SearchBarProps) {
  // Views live in the sidebar and card types in the View menu; whatever is
  // narrowing the results shows as removable chips inside the field.
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
  // Both reset by typing: they belong to the text they were set for.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ index: number; query: string }>({
    index: -1,
    query: "",
  });
  const { start: tokenStart, token } = currentSearchToken(searchQuery);
  const { suggestions, completingValue } = useMemo(
    () =>
      onAddQualifier
        ? buildSearchSuggestions(token, suggestionSources ?? {})
        : { suggestions: [], completingValue: false },
    [onAddQualifier, suggestionSources, token]
  );
  const open =
    focused && dismissedFor !== searchQuery && suggestions.length > 0;
  // A value being completed starts on its first match so Enter picks it.
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
    if (suggestion.complete) {
      onAddQualifier?.(suggestion.insert);
      onSearchChange(before.trimEnd());
    } else {
      onSearchChange(`${before}${suggestion.insert}`);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
      // Closes the list only: the input keeps its text and the page
      // ignores this Escape.
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
    // Typing already filters live; committing on submit keeps Enter and
    // declarative WebMCP form fills applying the same search path.
    e.preventDefault();
    const query = new FormData(e.currentTarget).get("q");
    if (typeof query === "string") {
      onSearchChange(query);
    }
  };

  // Every filter narrowing the results, as one list of removable chips:
  // the first few sit inside the field, the rest behind "+N".
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
    const described = describeQualifierChip(chip);
    if (!described) {
      continue;
    }
    const { qualifier, label, title } = described;
    const unknownFolder =
      qualifier.key === "folder" &&
      folderNames !== undefined &&
      !folderNames.has(qualifier.value.trim().toLowerCase());
    let Icon: typeof Tag = QUALIFIER_ICONS[qualifier.key];
    if (qualifier.key === "type") {
      Icon = getFilterIcon(qualifier.value);
    } else if (qualifier.key === "is" && qualifier.value === "archived") {
      Icon = Archive;
    } else if (unknownFolder) {
      Icon = CircleSlash;
    }
    chips.push({
      ariaLabel: unknownFolder
        ? `Remove ${chip}: no folder named ${qualifier.value}`
        : `Remove ${title.toLowerCase()} ${label}`,
      dashed: unknownFolder,
      icon: <Icon />,
      key: `qualifier-${chip}`,
      label: unknownFolder ? `No folder named ${label}` : label,
      prefix: unknownFolder ? undefined : title,
      onRemove: () => onRemoveQualifier?.(chip),
    });
  }
  for (const keyword of keywordTags) {
    chips.push({
      ariaLabel: `Remove ${keyword}`,
      icon: keyword.startsWith('"') ? <Quote /> : <Hash />,
      key: `keyword-${keyword}`,
      label: keyword,
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
  // On phones the field hides behind a search button until it is opened
  // or already holds a search.
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
          {mobileOpen && (
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
          )}
          {onSortChange && onReshuffle && sort === "shuffle" && (
            <div className={cn(mobileOpen && "max-sm:hidden")}>
              <ReshuffleButton onReshuffle={onReshuffle} />
            </div>
          )}
          {(onToggleFilter || onSortChange) && (
            <div className={cn(mobileOpen && "max-sm:hidden")}>
              <ViewMenu
                activeTypes={filterTags}
                onClearTypes={() => {
                  for (const filter of filterTags) {
                    onRemoveFilter(filter);
                  }
                }}
                onSaveSearch={onSaveSearch}
                onSortChange={onSortChange}
                onToggleType={onToggleFilter}
                sort={sort}
              />
            </div>
          )}
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
          // On phones the open field takes the title's room.
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
        {/* A label, so a click anywhere on the field puts the cursor in it. */}
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
                      {chip.prefix && (
                        <span className="text-muted-foreground">
                          {chip.prefix}{" "}
                        </span>
                      )}
                      {chip.label}
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
            // Named for the page, not by the chips the field also holds.
            aria-label={placeholder}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="h-full min-w-20 flex-1 rounded-none border-0 bg-transparent px-0.5 text-sm shadow-none focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent [&::-webkit-search-cancel-button]:hidden"
            data-library-search=""
            id={inputId}
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

        {open && (
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
                      {suggestion.detail && (
                        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {suggestion.detail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </form>
    </PageHeader>
  );
}
