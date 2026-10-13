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
  Clock,
  Droplets,
  File,
  FileText,
  Hash,
  Image,
  Link as LinkIcon,
  Palette,
  Quote,
  Search,
  Sparkles,
  Video,
  Volume2,
  X,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { SortMenu } from "./SortMenu";

export interface SearchBarProps {
  filterTags: CardType[];
  /** Controls at the end of the bar, such as the sort menu. */
  HeaderActions?: ReactNode;
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  /** Shown before the search icon, such as the sidebar toggle. */
  leading?: ReactNode;
  onClearAll: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveFilter: (filter: CardType) => void;
  onRemoveHexFilter: (hex: string) => void;
  onRemoveHueFilter: (hue: ColorHueBucket) => void;
  onRemoveKeyword: (keyword: string) => void;
  onRemoveStyleFilter: (style: VisualStyle) => void;
  onRemoveTimeFilter: () => void;
  onSearchChange: (value: string) => void;
  /** Shows the sort menu when set. */
  onSortChange?: (sort: CardListSort) => void;
  placeholder?: string;
  searchQuery: string;
  sort?: CardListSort;
  styleFilters: VisualStyle[];
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

const getFilterIcon = (filter: CardType) => {
  const iconName = getCardTypeIcon(filter) as keyof typeof iconComponentMap;
  return iconComponentMap[iconName] || FileText;
};

function preventBlur(e: React.MouseEvent) {
  e.preventDefault();
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
  onClearAll,
  HeaderActions,
  leading,
  placeholder = "Search for anything...",
  sort = "newest",
  onSortChange,
}: SearchBarProps) {
  // Views and card types live in the sidebar; the row under the search box
  // shows only what is narrowing the results, each chip removable.
  const hasAnyFilters =
    keywordTags.length > 0 ||
    Boolean(timeFilter) ||
    filterTags.length > 0 ||
    styleFilters.length > 0 ||
    hueFilters.length > 0 ||
    hexFilters.length > 0;

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
        className="group flex items-center"
        onSubmit={handleSubmit}
        {...webMcpSearchAttributes}
      >
        {leading}
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground group-focus-within:stroke-[2.5] group-focus-within:text-primary group-hover:stroke-[2.5] group-hover:text-primary" />
        </div>

        <div className="relative flex-1">
          <Input
            autoCapitalize="off"
            autoCorrect="off"
            className="h-16 rounded-none border-0 bg-transparent focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent"
            name="q"
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            type="search"
            value={searchQuery}
            {...webMcpQueryAttributes}
          />
        </div>

        <div className="flex items-center gap-1">
          {onSortChange && <SortMenu onSortChange={onSortChange} sort={sort} />}
          {HeaderActions}
        </div>
      </form>
      {hasAnyFilters && (
        <div className="slide-in-from-top-2 fade-in-0 animate-in pb-5 duration-200">
          <div className="flex flex-wrap gap-2">
            {keywordTags.map((keyword) => (
              <Button
                key={`keyword-${keyword}`}
                onClick={() => onRemoveKeyword(keyword)}
                onMouseDown={preventBlur}
                size="sm"
                variant="secondary"
              >
                <Hash className="size-3.5 stroke-2" />
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
