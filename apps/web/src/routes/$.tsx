import { createFileRoute, Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthLayout } from "@/components/AuthLayout";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/$")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>404 — Page Not Found</CardTitle>
          <CardDescription>
            The page you&apos;re looking for doesn&apos;t exist. Do you want to
            return home?
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link to="/" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft />
            Go Home
          </Link>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
