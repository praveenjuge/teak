import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

export function CardSkeleton() {
  return (
    <Card className="p-6 min-h-50 flex flex-col justify-between">
      <div className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </Card>
  );
}

export function CardsGridSkeleton() {
  // Opacities from 100% to 20% in 11 steps
  const opacities = [
    "opacity-100",
    "opacity-95",
    "opacity-90",
    "opacity-85",
    "opacity-80",
    "opacity-75",
    "opacity-70",
    "opacity-60",
    "opacity-40",
    "opacity-20",
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {opacities.map((opacity, i) => (
        <div key={i} className={opacity}>
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}
