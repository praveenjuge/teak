import { UserButton, useUser } from "@clerk/chrome-extension";
import { useQuery } from "convex/react";
import { api } from "@teak/convex";

function App() {
  const { isLoaded, user } = useUser();
  const cardCount = useQuery(api.cards.getCardCount);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center p-4">
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <UserButton />
      <span className="text-sm font-medium">{cardCount} Cards</span>
    </div>
  );
}

export default App;
