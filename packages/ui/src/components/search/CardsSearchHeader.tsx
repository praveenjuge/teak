import type { ReactNode } from "react";
import { SearchBar, type SearchBarProps } from "./SearchBar";

export interface CardsSearchHeaderProps extends SearchBarProps {
  HeaderActions?: ReactNode;
  SettingsButton?: ReactNode;
}

export function CardsSearchHeader({
  HeaderActions,
  SettingsButton,
  ...searchBarProps
}: CardsSearchHeaderProps) {
  return (
    <SearchBar
      {...searchBarProps}
      HeaderActions={HeaderActions}
      SettingsButton={SettingsButton}
    />
  );
}
