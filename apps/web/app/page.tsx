import { preloadQuery } from "convex/nextjs";
import { api } from "@teak/convex";
import { getAuthToken } from "./auth";
import { HomeClient } from "./_components/HomeClient";

export const experimental_ppr = true;

export default async function HomePage() {
  const token = await getAuthToken();

  const preloadedCards = await preloadQuery(
    api.cards.searchCards,
    {
      searchQuery: undefined,
      types: undefined,
      favoritesOnly: undefined,
      showTrashOnly: undefined,
      limit: 100,
    },
    { token },
  );

  return <HomeClient preloadedCards={preloadedCards} />;
}
