import Link from "next/link";
import Logo from "@/components/Logo";

export function Footer() {
  return (
    <footer className="border-border border-t bg-background py-8">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <Logo />
          <div className="flex gap-6 text-muted-foreground">
            <Link className="hover:text-foreground" href="/docs">
              Documentation
            </Link>
            <Link className="hover:text-foreground" href="/pricing">
              Pricing
            </Link>
            <a
              className="hover:text-foreground"
              href="https://github.com/praveenjuge/teak"
              rel="noopener noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <a
              className="hover:text-foreground"
              href="https://x.com/praveenjuge"
              rel="noopener noreferrer"
              target="_blank"
            >
              X (Twitter)
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
