import Link from "next/link";
import Logo from "@/components/Logo";

export function Footer() {
  return (
    <footer className="border-border border-t bg-background py-8">
      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <Logo />
          <div className="flex gap-6 text-muted-foreground text-sm">
            <Link href="/docs" className="hover:text-foreground">
              Documentation
            </Link>
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <a
              href="https://github.com/praveenjuge/teak"
              className="hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://x.com/praveenjuge"
              className="hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              X (Twitter)
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
