import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { baseOptions } from "@/app/layout.config";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  const { links, ...docsOptions } = baseOptions;

  return (
    <HomeLayout {...baseOptions}>
      <DocsLayout
        tree={source.pageTree}
        {...docsOptions}
        nav={{ enabled: false }}
        sidebar={{ collapsible: false }}
      >
        {children}
      </DocsLayout>
    </HomeLayout>
  );
}
