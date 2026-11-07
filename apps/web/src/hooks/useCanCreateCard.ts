import { api } from "@teak/convex";
import { useQuery } from "@/lib/convexQueryHooks";

/**
 * Whether this account may make another card (the free card limit), or
 * `undefined` while that is loading. The one place the web app asks.
 */
export const useCanCreateCard = (): boolean | undefined =>
  useQuery(api.auth.getCardCreationStatus)?.canCreateCard;
