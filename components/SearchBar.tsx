import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { SearchTypeahead } from "./SearchTypeahead";
import { UserButton } from "@clerk/nextjs";
import { type TypeaheadOption } from "@/lib/constants";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  showTypeahead: boolean;
  onTypeaheadSelect: (option: TypeaheadOption) => void;
  onTypeaheadClose: () => void;
  typeaheadSelectedIndex: number;
  setTypeaheadSelectedIndex: (index: number) => void;
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  onKeyDown,
  showTypeahead,
  onTypeaheadSelect,
  onTypeaheadClose,
  typeaheadSelectedIndex,
  setTypeaheadSelectedIndex,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-4 h-14">
      <div className="relative flex-1 h-full">
        <Search className="absolute left-0 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4 select-auto pointer-events-none" />
        <Input
          ref={inputRef}
          type="search"
          placeholder="Search for anything..."
          value={searchQuery}
          onChange={onSearchChange}
          onKeyDown={onKeyDown}
          className="pl-7 rounded-none border-0 w-full focus-visible:outline-none focus-visible:ring-0 h-full"
          autoCapitalize="off"
          autoCorrect="off"
        />
        <SearchTypeahead
          searchValue={searchQuery}
          isVisible={showTypeahead}
          onSelect={onTypeaheadSelect}
          onClose={onTypeaheadClose}
          inputRef={inputRef}
          selectedIndex={typeaheadSelectedIndex}
          setSelectedIndex={setTypeaheadSelectedIndex}
        />
      </div>
      <UserButton />
    </div>
  );
}