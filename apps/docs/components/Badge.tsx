import * as React from "react";

type BadgeVariant = 
  | "default"
  | "secondary" 
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default:
    "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
  secondary:
    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
  destructive:
    "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20",
  outline: "text-foreground border-border",
  success:
    "border-transparent bg-primary/10 text-primary hover:bg-primary/20",
  warning:
    "border-transparent bg-muted text-muted-foreground hover:bg-muted/80",
  info:
    "border-transparent bg-accent text-accent-foreground hover:bg-accent/80",
};

function Badge({ className = "", variant = "default", ...props }: BadgeProps) {
  const baseClasses = "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
  const variantClasses = badgeVariants[variant];
  
  return (
    <div 
      className={`${baseClasses} ${variantClasses} ${className}`} 
      {...props} 
    />
  );
}

export { Badge };