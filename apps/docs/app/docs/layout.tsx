import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import Logo from "@/components/Logo";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ mode: "top", title: <Logo /> }}
      githubUrl="https://github.com/praveenjuge/teak"
    >
      {children}
    </DocsLayout>
  );
}
