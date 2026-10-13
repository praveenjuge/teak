import { useState } from "react";
import { useSearchSuggestionSources } from "../../hooks/useSearchSuggestionSources";
import { SearchBar, type SearchBarProps } from "./SearchBar";

export type CardsSearchHeaderProps = SearchBarProps;

/**
 * The library's search bar with its suggestions. Tags, folders and sites
 * load once the box is first used (or right away when the search already
 * has qualifiers, so a folder chip can tell whether the folder exists), and
 * only this header re-renders when they arrive.
 */
export function CardsSearchHeader(props: CardsSearchHeaderProps) {
  const [active, setActive] = useState(
    () => (props.qualifierChips?.length ?? 0) > 0
  );
  const sources = useSearchSuggestionSources(active);
  return (
    <SearchBar
      {...props}
      onActivate={() => {
        setActive(true);
        props.onActivate?.();
      }}
      suggestionSources={props.suggestionSources ?? sources}
    />
  );
}
