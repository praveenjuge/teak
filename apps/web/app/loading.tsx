import { Spinner } from "@/components/ui/spinner";

export default function Loading({
  fullscreen = true,
}: {
  fullscreen?: boolean;
}) {
  if (!fullscreen) {
    return (
      <div className="flex justify-center items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <section className="grid place-items-center min-h-screen w-full">
      <Spinner />
    </section>
  );
}
