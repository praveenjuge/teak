import { Suspense } from "react";
import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";
import { HomePageClient } from "./HomePageClient";
import Loading from "./loading";

export default function HomePage() {
  return (
    <Suspense fallback={<Loading fullscreen={false} />}>
      <AuthenticatedAppProvider>
        <HomePageClient />
      </AuthenticatedAppProvider>
    </Suspense>
  );
}
