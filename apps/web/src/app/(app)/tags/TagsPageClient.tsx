"use client";

import { TagsScreen } from "@teak/ui/screens";
import { SidebarToggle } from "@teak/ui/sidebar";
import Link from "next/link";

export function TagsPageClient() {
  return (
    <TagsScreen
      headerLeading={<SidebarToggle className="-ml-2" />}
      LinkComponent={Link}
    />
  );
}
