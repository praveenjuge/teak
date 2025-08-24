import { Icon } from './Icon';

interface ChecklistItemProps {
  children: React.ReactNode;
}

export function ChecklistItem({ children }: ChecklistItemProps) {
  return (
    <li className="flex items-center">
      <Icon className="mr-3 h-5 w-5 text-green-500" name="check" />
      {children}
    </li>
  );
}
