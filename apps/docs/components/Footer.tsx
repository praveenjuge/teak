import Logo from "@/components/Logo";

export function Footer() {
  return (
    <footer className="border-border border-t bg-background px-4 py-8">
      <div className="mx-auto flex max-w-md flex-col items-center justify-between gap-4 sm:flex-row">
        <Logo />
        <div className="flex gap-6 text-muted-foreground">
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
    </footer>
  );
}
