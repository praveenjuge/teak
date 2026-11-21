import { createFileRoute } from "@tanstack/react-router";
import { titleHead } from "@/lib/pageTitle";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const Route = createFileRoute("/_app/favorites")({
  head: titleHead("Favorites"),
  component: () => <LibraryScreen view="favorites" />,
});
