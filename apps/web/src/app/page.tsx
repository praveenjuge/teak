import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";
import { HomePageClient } from "./HomePageClient";

export default function HomePage() {
  return (
    <AuthenticatedAppProvider>
      <HomePageClient />
    </AuthenticatedAppProvider>
  );
}
