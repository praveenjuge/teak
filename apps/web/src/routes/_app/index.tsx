import { createFileRoute } from "@tanstack/react-router";
import { prewarmPageLoader } from "@/lib/convexClient";
import { titleHead } from "@/lib/pageTitle";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const Route = createFileRoute("/_app/")({
  loader: prewarmPageLoader,
  head: titleHead(),
  component: () => <LibraryScreen />,
});
