"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";

export function UserProfileDropdown() {
  const router = useRouter();
  const [signOutLoading, setSignOutLoading] = useState(false);
  const { setTheme, theme } = useTheme();

  // @ts-ignore
  const user = useQuery(api.auth.getCurrentUser);

  const handleSignOut = async () => {
    setSignOutLoading(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          setSignOutLoading(false);
          router.push("/");
        },
      },
    });
  };

  const getUserInitials = () => {
    if (!user?.email) return "U";
    const email = user.email;
    const parts = email.split("@")[0].split(".");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  };

  return (
    <Suspense>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="size-7 cursor-pointer hover:opacity-80 transition-opacity">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {getUserInitials()}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
          <DropdownMenuLabel>{user?._id}</DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme || "system"}
            onValueChange={setTheme}
          >
            <DropdownMenuRadioItem value="system">
              <Monitor />
              System
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <Sun />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon />
              Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            {/* @ts-ignore */}
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleSignOut} disabled={signOutLoading}>
            <LogOut />
            {signOutLoading ? "Signing Out..." : "Sign Out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Suspense>
  );
}
