import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { baseOptions } from "@/app/layout.config";
import { CTASection } from "@/components/CTASection";
import { Footer } from "@/components/Footer";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions}>
      {children}
      <CTASection
        title="Ready to start visual bookmarking?"
        description="Start bookmarking, organizing, and managing your most important design inspiration with Teak."
        primaryCTA={{
          text: "Get Started",
          href: "https://app.teakvault.com",
        }}
        secondaryCTA={{
          text: "View Documentation",
          href: "/docs",
        }}
      />
      <Footer />
    </HomeLayout>
  );
}
