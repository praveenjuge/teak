"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems: { href: Route; label: string }[] = [
  //@ts-ignore
  { href: "/settings", label: "Profile" },
  { href: "/subscription", label: "Subscription & Billing" },
];

export function SettingsSidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2">
      {navItems.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({
                variant: isActive ? "default" : "outline",
                size: "lg",
              })
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
