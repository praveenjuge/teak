import { Suspense } from "react";
import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";
import { HomePageClient } from "./HomePageClient";

export default function HomePage() {
  return (
    <AuthenticatedAppProvider>
      <Suspense>
        <HomePageClient />
      </Suspense>
    </AuthenticatedAppProvider>
  );
}
