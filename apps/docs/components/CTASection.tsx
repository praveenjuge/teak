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
        <h2 className="mx-auto mb-4 max-w-sm text-balance font-bold text-4xl tracking-tight">
          {title}
        </h2>
        <p className="mx-auto mb-8 max-w-xl text-balance text-lg text-muted-foreground">
          {description}
        </p>
        <Button asChild size="lg">
          <a href={primaryCTA.href} rel="noopener noreferrer" target="_blank">
            {primaryCTA.text}
          </a>
        </Button>
      </div>
    </section>
  );
}
