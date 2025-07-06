import { useState } from "react";
import { Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { authClient, useSession } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";

export default function SettingsModal() {
  const { data: session } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      window.location.reload();
      setSettingsOpen(false);
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Settings className="size-4.5" />
          <span className="sr-only">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between h-8">
            <span className="text-muted-foreground">Email</span>
            <span>{session?.user.email}</span>
          </div>
          <div className="flex items-center justify-between h-8">
            <span className="text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between h-8">
            <span className="text-muted-foreground">You are Logged In</span>
            <Button onClick={handleSignOut} variant="outline" size="sm">
              <LogOut />
              Logout
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
