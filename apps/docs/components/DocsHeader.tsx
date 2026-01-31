"use client";

import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/app/layout.config";

/**
 * A wrapper component that renders only the HomeLayout header for use in docs pages.
 * This extracts just the navigation portion of HomeLayout without the main content wrapper.
 */
export function DocsHeader() {
  return (
    <HomeLayout {...baseOptions}>
      {/* Empty children - we only want the header */}
      {null}
    </HomeLayout>
  );
}
