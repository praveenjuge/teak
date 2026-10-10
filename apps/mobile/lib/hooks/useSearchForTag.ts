import { useRouter } from "expo-router";
import { useCallback } from "react";

/** Closes the card sheet and searches Home for a tag, like the web's tag badges. */
export function useSearchForTag() {
  const router = useRouter();
  return useCallback(
    (tag: string) => {
      router.dismissTo({ params: { q: tag }, pathname: "/(tabs)/(home)" });
    },
    [router]
  );
}
