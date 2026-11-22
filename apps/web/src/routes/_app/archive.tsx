import { createFileRoute } from "@tanstack/react-router";
import { prewarmPageLoader } from "@/lib/convexClient";
import { titleHead } from "@/lib/pageTitle";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const Route = createFileRoute("/_app/archive")({
  loader: prewarmPageLoader,
  head: titleHead((t) => t("lib.libraryViews.labels.archive")),
  component: () => <LibraryScreen view="archive" />,
});
