import { createFileRoute, redirect } from '@tanstack/react-router';
import { CardsGrid } from '@/components/CardsGrid';
import { Header } from '@/components/Header';
import { SearchProvider } from '@/contexts/SearchContext';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/')({
  component: HomeComponent,
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      throw redirect({
        to: '/login',
      });
    }
  },
});

function HomeComponent() {
  return (
    <SearchProvider>
      <Header />
      <CardsGrid />
    </SearchProvider>
  );
}
