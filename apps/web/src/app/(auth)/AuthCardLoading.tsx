import { CardContent } from "@teak/ui/components/ui/card";
import { Spinner } from "@teak/ui/components/ui/spinner";

export function AuthCardLoading() {
  return (
    <CardContent
      aria-label="Loading authentication"
      className="flex min-h-16 items-center justify-center py-8"
      role="status"
    >
      <Spinner className="size-5" />
    </CardContent>
  );
}
