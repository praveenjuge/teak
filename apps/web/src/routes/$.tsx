import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { AuthLayout } from '@/components/AuthLayout';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const Route = createFileRoute('/$')({
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
          <Link className={buttonVariants({ variant: 'outline' })} to="/">
            <ArrowLeft />
            Go Home
          </Link>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
