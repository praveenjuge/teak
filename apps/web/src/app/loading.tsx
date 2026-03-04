import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";

export default function Loading({
  fullscreen = true,
}: {
  fullscreen?: boolean;
}) {
  return <PageLoadingState fullScreen={fullscreen} />;
}
