import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import SettingsModal from "./SettingsModal";

export function Header() {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    console.log("Searching for:", searchQuery);
  };

  return (
    <header className="max-w-7xl mx-auto flex items-center justify-between h-14 mb-4 gap-2">
      <form onSubmit={handleSearch} className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
        <Input
          type="search"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </form>
      <SettingsModal />
    </header>
  );
}
