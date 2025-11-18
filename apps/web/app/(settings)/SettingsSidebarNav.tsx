"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems: { href: Route; label: string }[] = [
  //@ts-ignore
  { href: "/settings", label: "Profile" },
  { href: "/subscription", label: "Subscription & Billing" },
];

export function SettingsSidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-px">
      {navItems.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              isActive
                ? "font-semibold text-primary bg-background border-border!"
                : "text-muted-foreground hover:text-primary",
              "px-4 py-2.5 rounded-t-lg font-medium border border-transparent border-b-0"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
