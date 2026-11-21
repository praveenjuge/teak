import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
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
  // The query is only the screen's starting value, so replacing the URL as
  // someone types keeps the same screen mounted and the caret where it is.
  const navigate = useNavigate();
  const keepQuery = useCallback(
    (query: string) => {
      navigate({
        href: tagsPageUrl(window.location.href, query),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate]
  );
  return (
    <TagsScreen
      headerLeading={<SidebarToggle className="-ml-2" />}
      initialQuery={initialQuery}
      LinkComponent={IntentLink}
      onQueryChange={keepQuery}
    />
  );
}
