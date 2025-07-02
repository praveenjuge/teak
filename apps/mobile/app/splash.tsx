import { SplashScreen } from "expo-router";
import { authClient } from "../lib/auth-client";

export default function SplashScreenController() {
  const { data: session, isPending } = authClient.useSession();

  if (!isPending && !session) {
    SplashScreen.hideAsync();
  }

  return null;
}
