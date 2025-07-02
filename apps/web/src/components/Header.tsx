import { useState } from "react";
import { Search, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header() {
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Handle user sign out
  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      setSettingsOpen(false);
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  };

  // Handle search form submission
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    // TODO: Implement search functionality
    console.log("Searching for:", searchQuery);
  };

  return (
    <header className="max-w-7xl mx-auto flex items-center justify-between h-14 mb-4">
      <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
        <Input
          type="search"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </form>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon">
            <Settings />
            <span className="sr-only">Settings</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[400px] p-0">
          <DialogHeader className="px-6 py-4 pb-2">
            <DialogTitle className="text-lg font-semibold">
              Settings
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <ThemeToggle />
            <Button
              onClick={handleSignOut}
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 px-3 py-2.5 h-auto"
            >
              <LogOut className="h-4 w-4" />
              <span className="text-sm">Sign Out</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
