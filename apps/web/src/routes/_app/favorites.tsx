import { createFileRoute } from "@tanstack/react-router";
import { prewarmPageLoader } from "@/lib/convexClient";
import { titleHead } from "@/lib/pageTitle";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const Route = createFileRoute("/_app/favorites")({
  loader: prewarmPageLoader,
  head: titleHead((t) => t("lib.libraryViews.labels.favorites")),
  component: () => <LibraryScreen view="favorites" />,
});
