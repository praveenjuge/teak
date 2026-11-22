import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { SidebarToggle } from "@/components/sidebar";
import { prewarmPageLoader } from "@/lib/convexClient";
import { titleHead } from "@/lib/pageTitle";
import { TAGS_QUERY_PARAM, tagsPageUrl } from "@/lib/tags";
import { TagsScreen } from "@/screens";

export const Route = createFileRoute("/_app/tags")({
  loader: prewarmPageLoader,
  head: titleHead((t) => t("screens.tags.title")),
  component: TagsPage,
});

function TagsPage() {
  const initialQuery = Route.useSearch({
    select: (search) => search[TAGS_QUERY_PARAM] ?? "",
  });
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
      onQueryChange={keepQuery}
    />
  );
}
