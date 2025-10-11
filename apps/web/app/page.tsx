import HomeClient from "@/components/HomeClient";
import { preloadQuery } from "convex/nextjs";
import { api } from "@teak/convex";
import { getAuthToken } from "./auth";

const DEFAULT_CARD_LIMIT = 100;

export default async function HomePage() {
  const token = await getAuthToken();

  const preloadedCards = await preloadQuery(
    api.cards.searchCards,
    { limit: DEFAULT_CARD_LIMIT },
    token ? { token } : undefined
  );

  return <HomeClient preloadedCards={preloadedCards} />;
}
