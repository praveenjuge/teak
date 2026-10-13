import { SearchBar, type SearchBarProps } from "./SearchBar";

export type CardsSearchHeaderProps = SearchBarProps;

export function CardsSearchHeader(props: CardsSearchHeaderProps) {
  return <SearchBar {...props} />;
}
