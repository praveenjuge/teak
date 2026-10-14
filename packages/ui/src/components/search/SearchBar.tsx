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
import { Input } from "@teak/ui/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@teak/ui/components/ui/tooltip";
import { cn } from "@teak/ui/lib/utils";
import {
  Archive,
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
  useState,
} from "react";
import { ReshuffleButton, SortMenu } from "./SortMenu";
import {
  buildSearchSuggestions,
  currentSearchToken,
  describeQualifierChip,
  type SearchSuggestion,
  type SearchSuggestionSources,
} from "./searchSuggestions";

export interface SearchBarProps {
  filterTags: CardType[];
  /** Controls at the end of the bar, such as the sort menu. */
  HeaderActions?: ReactNode;
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  /** Shown before the search icon, such as the sidebar toggle. */
  leading?: ReactNode;
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
  /** Shuffles again; shown next to the sort menu while the sort is Shuffle. */
  onReshuffle?: () => void;
  /**
   * Saves what is on screen as a smart folder; offered in the sort menu
   * while set (there is a search to save).
   */
  onSaveSearch?: () => void;
  onSearchChange: (value: string) => void;
  /** Shows the sort menu when set. */
  onSortChange?: (sort: CardListSort) => void;
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

/** A long chip label stays one line; the full text is in a tooltip. */
function ChipLabel({ text }: { text: string }) {
  if (text.length <= 28) {
    return (
      <span className="truncate" dir="auto">
        {text}
      </span>
    );
  }
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate" dir="auto">
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 break-all">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function QualifierChip({
  chip,
  folderNames,
  onRemove,
}: {
  chip: string;
  /** Lowercased folder names, once the folder list has loaded. */
  folderNames?: ReadonlySet<string>;
  onRemove?: (chip: string) => void;
}) {
  const described = describeQualifierChip(chip);
  if (!described) {
    return null;
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
  return (
    <Button
      aria-label={
        unknownFolder
          ? `Remove ${chip}: no folder named ${qualifier.value}`
          : `Remove ${title.toLowerCase()} ${label}`
      }
      className={cn(
        "max-w-[min(18rem,100%)]",
        unknownFolder && "border-dashed text-muted-foreground"
      )}
      onClick={() => onRemove?.(chip)}
      onMouseDown={preventBlur}
      size="sm"
      variant={unknownFolder ? "outline" : "secondary"}
    >
      <Icon className="size-3.5 shrink-0 stroke-2" />
      {unknownFolder ? (
        <ChipLabel text={`No folder named ${label}`} />
      ) : (
        <>
          <span className="shrink-0 text-muted-foreground">{title}</span>
          <ChipLabel text={label} />
        </>
      )}
      <X aria-hidden="true" className="size-3 shrink-0 opacity-60" />
    </Button>
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
  placeholder = "Search for anything...",
  sort = "newest",
  onSaveSearch,
  onSortChange,
  onReshuffle,
}: SearchBarProps) {
  // Views and card types live in the sidebar; the row under the search box
  // shows only what is narrowing the results, each chip removable.
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
  const [focused, setFocused] = useState(false);
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

  return (
    <>
      <form
        aria-label="Search cards"
        className="group relative flex items-center"
        onSubmit={handleSubmit}
        {...webMcpSearchAttributes}
      >
        {leading}
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground group-focus-within:stroke-[2.5] group-focus-within:text-primary group-hover:stroke-[2.5] group-hover:text-primary" />
        </div>

        <div className="relative flex-1">
          <Input
            aria-activedescendant={
              open && active >= 0 ? optionId(active) : undefined
            }
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-expanded={open}
            aria-keyshortcuts="/"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="h-16 rounded-none border-0 bg-transparent focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent"
            data-library-search=""
            name="q"
            onBlur={() => setFocused(false)}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => {
              setFocused(true);
              onActivate?.();
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            role="combobox"
            spellCheck={false}
            type="search"
            value={searchQuery}
            {...webMcpQueryAttributes}
          />
        </div>

        <div className="flex items-center gap-1">
          {onSortChange && onReshuffle && sort === "shuffle" && (
            <ReshuffleButton onReshuffle={onReshuffle} />
          )}
          {onSortChange && (
            <SortMenu
              onSaveSearch={onSaveSearch}
              onSortChange={onSortChange}
              sort={sort}
            />
          )}
          {HeaderActions}
        </div>

        {open && (
          <div
            aria-label="Search suggestions"
            className="fade-in-0 zoom-in-95 absolute inset-x-0 top-full z-50 -mt-2 max-h-80 animate-in overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-md duration-100"
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
      {hasAnyFilters && (
        <div className="slide-in-from-top-2 fade-in-0 animate-in pb-5 duration-200">
          <div className="flex flex-wrap gap-2">
            {tagFilter && (
              <Button
                aria-label={`Remove tag filter ${tagFilter}`}
                className="max-w-full"
                key="tag-filter"
                onClick={onRemoveTagFilter}
                onMouseDown={preventBlur}
                size="sm"
                variant="secondary"
              >
                <Tag className="size-3.5 stroke-2" />
                <span className="truncate" dir="auto">
                  {tagFilter}
                </span>
                <X aria-hidden="true" className="size-3 opacity-60" />
              </Button>
            )}

            {qualifierChips.map((chip) => (
              <QualifierChip
                chip={chip}
                folderNames={folderNames}
                key={`qualifier-${chip}`}
                onRemove={onRemoveQualifier}
              />
            ))}

            {keywordTags.map((keyword) => (
              <Button
                key={`keyword-${keyword}`}
                onClick={() => onRemoveKeyword(keyword)}
                onMouseDown={preventBlur}
                size="sm"
                variant="secondary"
              >
                {keyword.startsWith('"') ? (
                  <Quote className="size-3.5 stroke-2" />
                ) : (
                  <Hash className="size-3.5 stroke-2" />
                )}
                <span>{keyword}</span>
                <X aria-hidden="true" className="size-3 opacity-60" />
              </Button>
            ))}

            {timeFilter && (
              <Button
                key="time-filter"
                onClick={onRemoveTimeFilter}
                onMouseDown={preventBlur}
                size="sm"
                variant="secondary"
              >
                <Clock className="size-3.5 stroke-2" />
                <span>{timeFilter.label}</span>
                <X aria-hidden="true" className="size-3 opacity-60" />
              </Button>
            )}

            {filterTags.map((filter) => {
              const IconComponent = getFilterIcon(filter);
              return (
                <Button
                  aria-pressed={true}
                  key={`filter-${filter}`}
                  onClick={() => onRemoveFilter(filter)}
                  onMouseDown={preventBlur}
                  size="sm"
                  variant="secondary"
                >
                  <IconComponent className="size-3.5 stroke-2" />
                  <span>{CARD_TYPE_LABELS[filter]}</span>
                  <X aria-hidden="true" className="size-3 opacity-60" />
                </Button>
              );
            })}

            {styleFilters.map((style) => (
              <Button
                key={`style-${style}`}
                onClick={() => onRemoveStyleFilter(style)}
                onMouseDown={preventBlur}
                size="sm"
                variant="secondary"
              >
                <Sparkles className="size-3.5 stroke-2" />
                <span>{VISUAL_STYLE_LABELS[style]}</span>
                <X aria-hidden="true" className="size-3 opacity-60" />
              </Button>
            ))}

            {hueFilters.map((hue) => (
              <Button
                key={`hue-${hue}`}
                onClick={() => onRemoveHueFilter(hue)}
                onMouseDown={preventBlur}
                size="sm"
                variant="secondary"
              >
                <Droplets className="size-3.5 stroke-2" />
                <span>{COLOR_HUE_LABELS[hue]}</span>
                <X aria-hidden="true" className="size-3 opacity-60" />
              </Button>
            ))}

            {hexFilters.map((hex) => (
              <Button
                key={`hex-${hex}`}
                onClick={() => onRemoveHexFilter(hex)}
                onMouseDown={preventBlur}
                size="sm"
                variant="secondary"
              >
                <span
                  className="size-3 rounded-full border"
                  style={{ backgroundColor: hex }}
                />
                <span>{hex}</span>
                <X aria-hidden="true" className="size-3 opacity-60" />
              </Button>
            ))}

            <Button
              onClick={onClearAll}
              onMouseDown={preventBlur}
              size="sm"
              variant="ghost"
            >
              Clear all
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
