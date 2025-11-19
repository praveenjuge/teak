"use client";

import { Suspense } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Settings } from "lucide-react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import Link from "next/link";

export function UserProfileDropdown() {
  // @ts-ignore
  const user = useQuery(api.auth.getCurrentUser);

  const getUserInitials = () => {
    if (!user?.email) return "U";
    const email = user.email;
    const parts = email.split("@")[0].split(".");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.slice(0, 1).toUpperCase();
  };

  return (
    <Suspense>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="size-7 cursor-pointer hover:opacity-80 transition-opacity">
            <AvatarImage
              alt="Profile"
              className="object-cover"
              src={user?.imageUrl ?? user?.image ?? undefined}
            />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {getUserInitials()}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            {/* @ts-ignore */}
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Suspense>
  );
}
