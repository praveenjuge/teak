import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import { baseOptions } from "@/app/layout.config";

export default function Layout({ children }: { children: ReactNode }) {
  const { links, ...docsOptions } = baseOptions;

  return (
    <HomeLayout {...baseOptions}>
      <DocsLayout
        tree={source.pageTree}
        {...docsOptions}
        sidebar={{ collapsible: false }}
        nav={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </HomeLayout>
  );
}
