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
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: 7 }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
