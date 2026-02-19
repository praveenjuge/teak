import { Button } from "@teak/ui/components/ui/button";
import Image from "next/image";

interface CTASectionProps {
  description: string;
  emoji: {
    alt: string;
    size: number;
    src: string;
  };
  primaryCTA: {
    href: string;
    text: string;
  };
  title: string;
}

export function CTASection({
  title,
  description,
  emoji,
  primaryCTA,
}: CTASectionProps) {
  return (
    <section className="border-border border-t bg-background py-20">
      <div className="container mx-auto px-4 text-center">
        {/* Thiings source: https://lftz25oez4aqbxpq.public.blob.vercel-storage.com/image-WTzQemgI0sKVWwbmuJiv5AppLYBsEA.png */}
        <Image
          alt={emoji.alt}
          className="mx-auto mb-4 object-contain"
          height={emoji.size}
          src={emoji.src}
          unoptimized
          width={emoji.size}
        />
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
