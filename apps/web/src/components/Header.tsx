import { useEffect, useRef } from "react";
import { Search, Loader2, X } from "lucide-react";
import SettingsModal from "./SettingsModal";
import { useSearch } from "@/contexts/SearchContext";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { Button } from "./ui/button";

export function Header() {
  const { searchQuery, setSearchQuery } = useSearch();
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const inputRef = useRef<HTMLInputElement>(null);

  // Show loading indicator when user is typing but query hasn't been processed yet
  const isSearching =
    searchQuery !== debouncedSearchQuery && searchQuery.trim().length > 0;

  // Keyboard shortcut to focus search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Search is handled automatically through the context
  };

  return (
    <header className="flex items-center gap-2">
      <form onSubmit={handleSearch} className="relative flex-1">
        {isSearching ? (
          <Loader2 className="pointer-events-none absolute left-0 top-1/2 transform -translate-y-1/2 text-primary size-5 animate-spin" />
        ) : (
          <Search className="pointer-events-none absolute left-0 top-1/2 transform -translate-y-1/2 text-muted-foreground size-5" />
        )}
        <input
          type="text"
          ref={inputRef}
          className="pl-7 h-16 w-full outline-0 text-base"
          value={searchQuery}
          placeholder="Search cards... (⌘K)"
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 transform -translate-y-1/2"
            onClick={() => setSearchQuery("")}
          >
            <X />
          </Button>
        )}
      </form>
      <SettingsModal />
    </header>
  );
}
