import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { Header as HomeHeader } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import { baseOptions } from "@/app/layout.config";

export default function Layout({ children }: { children: ReactNode }) {
  const { nav, links: _links, ...restOptions } = baseOptions;

  return (
    <DocsLayout
      tree={source.pageTree}
      {...restOptions}
      sidebar={{ collapsible: false }}
      // Replace the mobile-only docs navbar with the full home header
      nav={{
        ...nav,
        // Hide logo/title inside the docs sidebar
        title: null,
        component: <HomeHeader {...baseOptions} />,
      }}
    >
      <div className="on-root:[--fd-nav-height:56px]">{children}</div>
    </DocsLayout>
  );
}
