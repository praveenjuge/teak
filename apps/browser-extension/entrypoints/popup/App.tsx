import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AuthenticatedView } from './components/AuthenticatedView';
import { LoginForm } from './components/LoginForm';
import { authClient } from './lib/auth-client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

interface User {
  id: string;
  name: string;
  email: string;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const session = await authClient.getSession();
      if (session.data?.user) {
        setUser({
          id: session.data.user.id,
          name: session.data.user.name,
          email: session.data.user.email,
        });
      }
    } catch (error) {
      console.error('Session check error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSuccess = () => {
    checkAuthStatus();
  };

  if (isLoading) {
    return (
      <div className="loading">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app">
        {user ? (
          <AuthenticatedView user={user} />
        ) : (
          <LoginForm onLoginSuccess={handleLoginSuccess} />
        )}
      </div>
    </QueryClientProvider>
  );
}

export default App;
