import { Shield, Zap, Smartphone, Search, Layers, Heart } from 'lucide-react';

interface FeatureCardProps {
  icon: 'shield' | 'lightning' | 'mobile' | 'search' | 'stack' | 'heart';
  title: string;
  description: string;
}

const iconMap = {
  shield: Shield,
  lightning: Zap,
  mobile: Smartphone,
  search: Search,
  stack: Layers,
  heart: Heart,
};

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  const IconComponent = iconMap[icon];
  
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
        <IconComponent className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mb-2 font-semibold text-xl">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
