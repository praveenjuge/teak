import { Check } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface PricingCardProps {
  name: string;
  price:
    | string
    | {
        monthly: { amount: string; period: string };
        yearly: { amount: string; period: string };
      };
  description: string;
  features: string[];
  cta: {
    text: string;
    href: string;
    primary?: boolean;
  };
  popular?: boolean;
  isYearly?: boolean;
  badge?: string;
}

export function PricingCard({
  name,
  price,
  description,
  features,
  cta,
  popular = false,
  isYearly = false,
  badge,
}: PricingCardProps) {
  const renderPrice = () => {
    if (typeof price === "string") {
      return (
        <div className="mb-4">
          <span className="font-bold text-4xl tracking-tight">{price}</span>
          {price !== "Free" && price !== "Free*" && (
            <span className="text-muted-foreground">/month</span>
          )}
        </div>
      );
    }

    const currentPrice = isYearly ? price.yearly : price.monthly;
    return (
      <div className="mb-4">
        <span className="font-bold text-4xl tracking-tight">
          {currentPrice.amount}
        </span>
        <span className="text-muted-foreground">/{currentPrice.period}</span>
      </div>
    );
  };

  return (
    <div
      className={`relative rounded-lg border bg-card p-8 ${
        popular ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 transform">
          <Badge>Most Popular</Badge>
        </div>
      )}

      {badge && (
        <div className="absolute -top-3 right-4">
          <Badge variant="secondary">{badge}</Badge>
        </div>
      )}

      <div className="text-center">
        <h3 className="mb-2 font-semibold text-base text-muted-foreground">
          {name}
        </h3>
        {renderPrice()}
        <p className="mb-6 text-muted-foreground">{description}</p>
      </div>

      <ul className="mb-8 space-y-3">
        {features.map((feature) => (
          <li className="flex items-start gap-3" key={feature}>
            <div className="mt-1 text-primary">
              <Check size={16} />
            </div>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        className="w-full"
        variant={cta.primary ? "default" : "outline"}
      >
        <a href={cta.href} rel="noopener noreferrer" target="_blank">
          {cta.text}
        </a>
      </Button>
    </div>
  );
}
