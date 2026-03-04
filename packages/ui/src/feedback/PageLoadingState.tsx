import { Spinner } from "@teak/ui/components/ui/spinner";

interface PageLoadingStateProps {
  fullScreen?: boolean;
}

export function PageLoadingState({
  fullScreen = true,
}: PageLoadingStateProps) {
  if (!fullScreen) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <section className="grid min-h-screen w-full place-items-center">
      <Spinner />
    </section>
  );
}
