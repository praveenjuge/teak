import { useTranslations } from "@teak/i18n/react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GRID_GUTTER,
  gridColumnsTemplate,
  MAX_COLUMNS,
  MIN_COLUMN_WIDTH,
} from "../grids/gridColumns";

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

const SKELETON_OPACITIES = [
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

interface CardsGridSkeletonProps {
  gutter?: number;
  maxColumns?: number;
  minColumnWidth?: number;
}

/** Stands in for the masonry with the same columns, so nothing jumps. */
export function CardsGridSkeleton({
  gutter = GRID_GUTTER,
  maxColumns = MAX_COLUMNS,
  minColumnWidth = MIN_COLUMN_WIDTH,
}: CardsGridSkeletonProps = {}) {
  const t = useTranslations("feedback.cardsGrid");
  return (
    <div
      aria-label={t("loading")}
      className="grid items-start"
      role="status"
      style={{
        gap: gutter,
        gridTemplateColumns: gridColumnsTemplate(
          gutter,
          minColumnWidth,
          maxColumns
        ),
      }}
    >
      {SKELETON_OPACITIES.map((opacity) => (
        <div className={opacity} key={opacity}>
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}
