"use client";

import { Button, buttonVariants } from "@teak/ui/components/ui/button";
import { cn } from "@teak/ui/lib/utils";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";

const navLinks = [
  { name: "Pricing", href: "/pricing" },
  { name: "Apps", href: "/apps" },
  { name: "Changelog", href: "/changelog" },
  { name: "Docs", href: "/docs" },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const buttonClass = cn(
    buttonVariants({ variant: "ghost", size: "sm" }),
    "bg-transparent text-white/80 hover:bg-white/10 hover:text-white"
  );

  return (
    <header className="fixed top-0 left-0 z-50 w-full md:top-4 md:left-1/2 md:w-auto md:-translate-x-1/2">
      <nav
        className={cn(
          "relative z-50 flex items-center justify-between gap-1 bg-zinc-900 py-2 pr-2 pl-4.5 md:rounded-xl",
          isOpen && "flex-col items-start"
        )}
      >
        <div className="flex w-full items-center justify-between">
          <Link className="mr-3 flex items-center justify-center" href="/">
            <Logo className="h-4.5 text-primary-foreground" variant="current" />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link className={buttonClass} href={link.href} key={link.href}>
                {link.name}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <a href="https://app.teakvault.com/login">
              <Button className={buttonClass} size="sm" variant="ghost">
                Login
              </Button>
            </a>
            <a href="https://app.teakvault.com/register">
              <Button size="sm">Register</Button>
            </a>

            <Button
              className="bg-transparent text-white/80 hover:bg-white/10 hover:text-white md:hidden"
              onClick={() => setIsOpen(!isOpen)}
              size="icon"
              variant="ghost"
            >
              {isOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </div>

        {isOpen && (
          <div className="my-2 flex w-full flex-col gap-2 md:hidden">
            {navLinks.map((link) => (
              <Link
                className="rounded-lg py-3 font-medium text-white/80 text-xl transition-colors hover:text-white"
                href={link.href}
                key={link.href}
                onClick={() => setIsOpen(false)}
              >
                {link.name}
              </Link>
            ))}
          </div>
        )}
      </nav>
    </header>
  );
}
