import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";
import { Header } from "@/components/Header";
import { AddCard } from "@/components/AddCard";
import { CardsGrid } from "@/components/CardsGrid";
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
      <AddCard />
      <CardsGrid />
    </>
  );
}
