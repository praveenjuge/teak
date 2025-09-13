import { Check } from "lucide-react";

interface PricingCardProps {
  name: string;
  price: string | {
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
  badge
}: PricingCardProps) {
  const renderPrice = () => {
    if (typeof price === 'string') {
      return (
        <div className="mb-4">
          <span className="font-bold text-3xl">{price}</span>
          {price !== "Free" && price !== "Free*" && <span className="text-muted-foreground">/month</span>}
        </div>
      );
    }

    const currentPrice = isYearly ? price.yearly : price.monthly;
    return (
      <div className="mb-4">
        <span className="font-bold text-3xl">{currentPrice.amount}</span>
        <span className="text-muted-foreground">/{currentPrice.period}</span>
        {isYearly && (
          <div className="text-muted-foreground text-sm mt-1">
            Save $129/year
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`relative rounded-lg border bg-card p-8 ${
      popular 
        ? 'border-primary shadow-lg scale-105' 
        : 'border-border'
    }`}>
      {popular && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <span className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-medium">
            Most Popular
          </span>
        </div>
      )}

      {badge && (
        <div className="absolute -top-3 right-4">
          <span className="bg-accent text-accent-foreground px-2 py-1 rounded-full text-xs font-medium">
            {badge}
          </span>
        </div>
      )}
      
      <div className="text-center">
        <h3 className="font-bold text-xl mb-2">{name}</h3>
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

      <a
        href={cta.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`block w-full text-center py-3 px-6 rounded-lg font-medium transition-colors ${
          cta.primary
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border border-border text-foreground hover:bg-muted'
        }`}
      >
        {cta.text}
      </a>
    </div>
  );
}