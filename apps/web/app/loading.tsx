import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <section className="grid place-items-center min-h-screen w-full">
      <Spinner />
    </section>
  );
}
