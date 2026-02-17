import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <div className="pt-20">
        <DocsLayout
          nav={{ enabled: false }}
          sidebar={{ collapsible: false }}
          tree={source.pageTree}
        >
          {children}
        </DocsLayout>
      </div>
    </>
  );
}
