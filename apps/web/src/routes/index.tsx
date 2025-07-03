import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";
import { Header } from "@/components/Header";
import { EmptyState } from "@/components/empty-state";
import { Axe } from "lucide-react";
import Loading from "@/components/loading";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && !session?.user) {
      navigate({ to: "/login" });
    }
  }, [session, isPending, navigate]);

  if (isPending) {
    return <Loading />;
  }

  if (!session?.user) {
    return null;
  }

  return (
    <>
      <Header />
      <EmptyState
        icon={Axe}
        title="Welcome to Teak"
        description="Add your first bookmark, note, or image to start the magic."
      />
    </>
  );
}
