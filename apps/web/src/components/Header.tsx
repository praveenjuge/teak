import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSearch } from '@/contexts/SearchContext';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import SettingsModal from './SettingsModal';
import { Button } from './ui/button';

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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Search is handled automatically through the context
  };

  return (
    <header className="flex items-center gap-2">
      <form className="relative flex-1" onSubmit={handleSearch}>
        {isSearching ? (
          <Loader2 className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-0 size-5 transform animate-spin text-primary" />
        ) : (
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-0 size-5 transform text-muted-foreground" />
        )}
        <input
          className="h-16 w-full pl-7 text-base outline-0"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search cards... (⌘K)"
          ref={inputRef}
          type="text"
          value={searchQuery}
        />
        {searchQuery && (
          <Button
            className="-translate-y-1/2 absolute top-1/2 right-2 transform"
            onClick={() => setSearchQuery('')}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        )}
      </form>
      <SettingsModal />
    </header>
  );
}
