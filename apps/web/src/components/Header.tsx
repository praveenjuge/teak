import { useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import SettingsModal from "./SettingsModal";
import { useSearch } from "@/contexts/SearchContext";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";

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
    <header className="flex items-center h-14 mb-4 gap-2">
      <form onSubmit={handleSearch} className="relative flex-1">
        {isSearching ? (
          <Loader2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary size-4 animate-spin" />
        ) : (
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
        )}
        <Input
          ref={inputRef}
          type="search"
          placeholder="Search cards... (⌘K)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </form>
      <SettingsModal />
    </header>
  );
}
