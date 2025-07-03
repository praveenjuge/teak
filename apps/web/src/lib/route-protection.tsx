import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "./auth-client";
import Loading from "@/components/loading";

// Hook to protect routes that require authentication
export function useRequireAuth() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && !session?.user) {
      navigate({ to: "/login" });
    }
  }, [session, isPending, navigate]);

  return { session, isPending, isAuthenticated: !!session?.user };
}

// Hook to redirect authenticated users away from auth pages
export function useRedirectIfAuthenticated(redirectTo = "/") {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session?.user) {
      navigate({ to: redirectTo });
    }
  }, [session, isPending, navigate, redirectTo]);

  return { session, isPending, isAuthenticated: !!session?.user };
}

// Component wrapper for protected routes
interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, isPending } = useRequireAuth();

  // Show loading state while checking authentication
  if (isPending) {
    return <Loading />;
  }

  // Show fallback or nothing if not authenticated
  if (!isAuthenticated) return fallback || null;

  return <>{children}</>;
}
