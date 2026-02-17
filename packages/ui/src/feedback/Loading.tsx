import { Spinner } from "@teak/ui/components/ui/spinner";

interface LoadingProps {
  className?: string;
  fullScreen?: boolean;
}

export function Loading({ fullScreen, className }: LoadingProps) {
  return (
    <div
      className={`grid place-items-center ${fullScreen ? "min-h-screen w-full" : "size-full"} ${className}`}
    >
      <Spinner />
    </div>
  );
}
