import { createFileRoute } from "@tanstack/react-router";
import { titleHead } from "@/lib/pageTitle";
import { OpenLinkScreen } from "@/screens/OpenLinkScreen";

export const Route = createFileRoute("/_standalone/open/$cardId")({
  head: titleHead("Opening link"),
  // The check and the redirect happen in the browser, so the server sends
  // the layout's quiet page and leaves this screen to the client.
  ssr: "data-only",
  component: OpenLinkPage,
});

function OpenLinkPage() {
  const { cardId } = Route.useParams();
  return <OpenLinkScreen cardId={cardId} key={cardId} />;
}
