import { Spinner } from "@teak/ui/components/ui/spinner";

export default function Loading({
  fullscreen = true,
}: {
  fullscreen?: boolean;
}) {
  if (!fullscreen) {
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
