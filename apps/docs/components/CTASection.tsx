import { Button } from "./ui/button";

interface CTASectionProps {
  title: string;
  description: string;
  primaryCTA: {
    text: string;
    href: string;
  };
}

export function CTASection({
  title,
  description,
  primaryCTA,
}: CTASectionProps) {
  return (
    <section className="border-border border-t bg-background py-20">
      <div className="container mx-auto px-4 text-center">
        <h2 className="mb-4 font-bold text-4xl text-balance tracking-tight max-w-sm mx-auto">
          {title}
        </h2>
        <p className="mx-auto mb-8 max-w-xl text-muted-foreground text-balance text-lg">
          {description}
        </p>
        <Button size="lg" asChild>
          <a href={primaryCTA.href} target="_blank" rel="noopener noreferrer">
            {primaryCTA.text}
          </a>
        </Button>
      </div>
    </section>
  );
}
