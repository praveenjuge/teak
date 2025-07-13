import { SplashScreen } from 'expo-router';
import { authClient } from '../lib/auth-client';

export default function SplashScreenController() {
  const sessionState = authClient?.useSession?.();
  const isPending = sessionState?.isPending ?? true;

  if (!isPending) {
    SplashScreen.hideAsync();
  }

  return null;
}
