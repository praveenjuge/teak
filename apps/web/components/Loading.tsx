import { Spinner } from "@/components/ui/spinner";

export function Loading({
  fullScreen,
  className,
}: {
  fullScreen?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`grid place-items-center ${fullScreen ? "min-h-screen w-full" : "size-full"} ${className}`}
    >
      <Spinner />
    </div>
  );
}
