import { createFileRoute } from "@tanstack/react-router";
import { titleHead } from "@/lib/pageTitle";
import { OpenLinkScreen } from "@/screens/OpenLinkScreen";

export const Route = createFileRoute("/_standalone/open/$cardId")({
  head: titleHead("Opening link"),
  component: OpenLinkPage,
});

function OpenLinkPage() {
  const { cardId } = Route.useParams();
  return <OpenLinkScreen cardId={cardId} key={cardId} />;
}
