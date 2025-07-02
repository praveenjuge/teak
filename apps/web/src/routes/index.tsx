import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";
import { Header } from "@/components/Header";

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
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session?.user) {
    return null; // Will redirect to login
  }

  return (
    <>
      <Header />
      <Card>
        <CardContent className="space-y-4">
          <div>
            <label className="font-medium text-muted-foreground">Email</label>
            <p>{session.user.email}</p>
          </div>
          <div>
            <label className="font-medium text-muted-foreground">User ID</label>
            <p className="font-mono">{session.user.id}</p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
