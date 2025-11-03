import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import Logo from "@/components/Logo";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      githubUrl="https://github.com/praveenjuge/teak"
      nav={{
        title: <Logo />,
      }}
    >
      {children}
    </DocsLayout>
  );
}
