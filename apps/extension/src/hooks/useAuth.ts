import { useUser } from "@clerk/chrome-extension"

export function useAuth() {
  const { user, isLoaded, isSignedIn } = useUser()

  return {
    user,
    isAuthenticated: isSignedIn,
    isLoading: !isLoaded,
    userId: user?.id,
    email: user?.primaryEmailAddress?.emailAddress
  }
}