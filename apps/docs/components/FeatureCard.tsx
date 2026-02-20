import Image from "next/image";

interface FeatureCardProps {
  description: string;
  emojiAlt: string;
  emojiSrc: string;
  title: string;
}

export function FeatureCard({
  emojiAlt,
  emojiSrc,
  title,
  description,
}: FeatureCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4">
        <Image
          alt={emojiAlt}
          className="size-14 object-contain"
          height={56}
          src={emojiSrc}
          unoptimized
          width={56}
        />
      </div>
      <h3 className="mb-2 font-semibold text-xl">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
