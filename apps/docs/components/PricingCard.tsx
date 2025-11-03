import { Check } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

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
        popular ? "border-primary ring-primary ring-1" : "border-border"
      }`}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <Badge>Most Popular</Badge>
        </div>
      )}

      {badge && (
        <div className="absolute -top-3 right-4">
          <Badge variant="secondary">{badge}</Badge>
        </div>
      )}

      <div className="text-center">
        <h3 className="font-semibold text-muted-foreground text-base mb-2">
          {name}
        </h3>
        {renderPrice()}
        <p className="text-muted-foreground mb-6">{description}</p>
      </div>

      <ul className="space-y-3 mb-8">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start gap-3">
            <div className="mt-1 text-primary">
              <Check size={16} />
            </div>
            <span className="text-sm">{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        variant={cta.primary ? "default" : "outline"}
        className="w-full"
        asChild
      >
        <a href={cta.href} target="_blank" rel="noopener noreferrer">
          {cta.text}
        </a>
      </Button>
    </div>
  );
}
