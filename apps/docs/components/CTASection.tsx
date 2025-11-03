import { Button } from "./ui/button";

interface CTASectionProps {
  title: string;
  description: string;
  primaryCTA: {
    text: string;
    href: string;
  };
  secondaryCTA: {
    text: string;
    href: string;
  };
}

export function CTASection({
  title,
  description,
  primaryCTA,
  secondaryCTA,
}: CTASectionProps) {
  return (
    <section className="border-border border-t bg-background py-20">
      <div className="container mx-auto px-4 text-center">
        <h2 className="mb-4 font-bold text-3xl text-balance tracking-tight">
          {title}
        </h2>
        <p className="mx-auto mb-8 max-w-xl text-muted-foreground text-balance">
          {description}
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button size="lg" asChild>
            <a href={primaryCTA.href} target="_blank" rel="noopener noreferrer">
              {primaryCTA.text}
            </a>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a
              href={secondaryCTA.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {secondaryCTA.text}
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
