import { Button } from "@teak/ui/components/ui/button";
import Logo from "@teak/ui/logo";
import { LogOut } from "lucide-react";
import type { PropsWithChildren } from "react";

interface LayoutProps extends PropsWithChildren {
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function Layout({ children, isLoggingOut, onLogout }: LayoutProps) {
  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Logo variant="primary" />
          <Button
            disabled={isLoggingOut}
            onClick={onLogout}
            size="sm"
            type="button"
            variant="outline"
          >
            <LogOut className="size-4" />
            Logout
          </Button>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-4 py-6">{children}</section>
    </main>
  );
}
