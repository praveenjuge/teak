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
        <h2 className="mb-4 font-bold text-3xl">{title}</h2>
        <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
          {description}
        </p>
        <div className="flex flex-col justify-center gap-4 sm:flex-row">
          <a
            className="inline-flex items-center justify-center rounded-lg bg-primary px-8 py-4 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            href={primaryCTA.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {primaryCTA.text}
          </a>
          <a
            className="inline-flex items-center justify-center rounded-lg border border-border px-8 py-4 font-medium text-foreground transition-colors hover:bg-muted"
            href={secondaryCTA.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {secondaryCTA.text}
          </a>
        </div>
      </div>
    </section>
  );
}
