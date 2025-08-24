import { Icon } from './Icon';

interface FeatureCardProps {
  icon: 'shield' | 'lightning' | 'mobile' | 'search' | 'stack' | 'heart';
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card p-6">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10">
        <Icon className="h-6 w-6 text-fd-primary" name={icon} />
      </div>
      <h3 className="mb-2 font-semibold text-xl">{title}</h3>
      <p className="text-fd-muted-foreground">{description}</p>
    </div>
  );
}
