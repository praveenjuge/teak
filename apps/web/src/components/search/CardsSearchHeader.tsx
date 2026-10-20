import { useState } from "react";
import { useSearchSuggestionSources } from "../../hooks/useSearchSuggestionSources";
import { SearchBar, type SearchBarProps } from "./SearchBar";

export type CardsSearchHeaderProps = SearchBarProps;

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
