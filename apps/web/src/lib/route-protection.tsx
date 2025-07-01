/**
 * Route Protection Utilities
 *
 * Provides utilities for protecting routes that require authentication
 */

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "./auth-client";

/**
 * Hook to protect routes that require authentication
 * Redirects to login if user is not authenticated
 */
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

/**
 * Hook to redirect authenticated users away from auth pages
 * Useful for login/register pages
 */
export function useRedirectIfAuthenticated(redirectTo: string = "/") {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session?.user) {
      navigate({ to: redirectTo });
    }
  }, [session, isPending, navigate, redirectTo]);

  return { session, isPending, isAuthenticated: !!session?.user };
}

/**
 * Component wrapper for protected routes
 */
interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, isPending } = useRequireAuth();

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback || null;
  }

  return <>{children}</>;
}
