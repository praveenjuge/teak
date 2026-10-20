import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { CARD_MODAL_SURFACE_CLASS } from "./cardModalFrame";

/** The details panel's shape while the card loads. */
function CardMetadataPanelSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6 px-5 py-5">
      {[0.6, 0.85, 0.45].map((width) => (
        <div className="space-y-2" key={width}>
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-4" style={{ width: `${width * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

/** The dialog's shape while its code or its card loads. */
export function CardModalSkeleton() {
  return (
    <div className={CARD_MODAL_SURFACE_CLASS}>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center px-5">
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="grid flex-1 place-items-center py-16">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        </div>
        <div className="shrink-0 border-border/60 max-md:border-t md:w-72 md:border-l lg:w-80 xl:w-[21rem]">
          <CardMetadataPanelSkeleton />
        </div>
      </div>
    </div>
  );
}
