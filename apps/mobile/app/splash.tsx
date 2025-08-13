import { SplashScreen } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';

export default function SplashScreenController() {
  const { isLoaded } = useAuth();

  // Hide splash screen when Clerk is fully loaded
  if (isLoaded) {
    SplashScreen.hideAsync();
  }

  return null;
}