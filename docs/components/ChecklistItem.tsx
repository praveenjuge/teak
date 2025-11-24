import { Check } from 'lucide-react';

interface ChecklistItemProps {
  children: React.ReactNode;
}

export function ChecklistItem({ children }: ChecklistItemProps) {
  return (
    <li className="flex items-center">
      <Check className="mr-3 h-5 w-5 text-primary" />
      {children}
    </li>
  );
}
