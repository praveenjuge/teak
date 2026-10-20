"use client";

import { IntentLink } from "@/components/app-shell/IntentLink";
import { SidebarToggle } from "@/components/sidebar";
import { TagsScreen } from "@/screens";

export function TagsPageClient() {
  return (
    <TagsScreen
      headerLeading={<SidebarToggle className="-ml-2" />}
      LinkComponent={IntentLink}
    />
  );
}
