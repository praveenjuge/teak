import Image from "next/image";

interface FeatureCardProps {
  description: string;
  emojiAlt?: string;
  emojiSrc?: string;
  title: string;
}

export function FeatureCard({
  emojiAlt,
  emojiSrc,
  title,
  description,
}: FeatureCardProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      {emojiSrc && (
        <Image
          alt={emojiAlt || ""}
          className="size-14 object-contain"
          height={56}
          src={emojiSrc || ""}
          unoptimized
          width={56}
        />
      )}
      <h3 className="mt-3 mb-1.5 font-semibold text-lg">{title}</h3>
      <p className="text-balance text-muted-foreground">{description}</p>
    </div>
  );
}
