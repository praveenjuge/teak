import { SplashScreen } from "expo-router";
import { authClient } from "../lib/auth-client";

export default function SplashScreenController() {
  const { isPending } = authClient.useSession();

  if (!isPending) {
    SplashScreen.hideAsync();
  }

  return null;
}
