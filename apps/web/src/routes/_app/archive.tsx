import { createFileRoute } from "@tanstack/react-router";
import { titleHead } from "@/lib/pageTitle";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const Route = createFileRoute("/_app/archive")({
  head: titleHead("Archive"),
  component: () => <LibraryScreen view="archive" />,
});
