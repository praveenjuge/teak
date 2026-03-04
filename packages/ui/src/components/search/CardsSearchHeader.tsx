import type { ReactNode } from "react";
import { SearchBar, type SearchBarProps } from "./SearchBar";

export interface CardsSearchHeaderProps extends SearchBarProps {
  SettingsButton?: ReactNode;
}

export function CardsSearchHeader({
  SettingsButton,
  ...searchBarProps
}: CardsSearchHeaderProps) {
  return <SearchBar {...searchBarProps} SettingsButton={SettingsButton} />;
}
