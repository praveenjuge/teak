import { Card } from "@teak/ui/components/ui/card";
import { Skeleton } from "@teak/ui/components/ui/skeleton";

export function CardSkeleton() {
  return (
    <Card className="flex min-h-32 flex-col justify-between p-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </Card>
  );
}

export function CardsGridSkeleton() {
  const opacities = [
    "opacity-95",
    "opacity-90",
    "opacity-85",
    "opacity-80",
    "opacity-75",
    "opacity-70",
    "opacity-65",
    "opacity-60",
    "opacity-55",
    "opacity-50",
    "opacity-45",
    "opacity-40",
    "opacity-35",
    "opacity-30",
    "opacity-25",
    "opacity-20",
    "opacity-15",
    "opacity-10",
    "opacity-5",
  ];
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
      {opacities.map((opacity) => (
        <div className={opacity} key={opacity}>
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}
