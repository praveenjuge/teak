import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useCallback } from "react";
import { IntentLink } from "@/components/app-shell/IntentLink";
import { SidebarToggle } from "@/components/sidebar";
import { titleHead } from "@/lib/pageTitle";
import { TAGS_QUERY_PARAM, tagsPageUrl } from "@/lib/tags";
import { TagsScreen } from "@/screens";

export const Route = createFileRoute("/_app/tags")({
  head: titleHead("Tags"),
  component: TagsPage,
});

function TagsPage() {
  const initialQuery =
    useLocation({
      select: (location) =>
        new URLSearchParams(location.searchStr).get(TAGS_QUERY_PARAM),
    }) ?? "";
  // Native history updates the URL without a navigation, so typing never
  // remounts the screen or moves the caret.
  const keepQuery = useCallback((query: string) => {
    window.history.replaceState(
      window.history.state,
      "",
      tagsPageUrl(window.location.href, query)
    );
  }, []);
  return (
    <TagsScreen
      headerLeading={<SidebarToggle className="-ml-2" />}
      initialQuery={initialQuery}
      LinkComponent={IntentLink}
      onQueryChange={keepQuery}
    />
  );
}
