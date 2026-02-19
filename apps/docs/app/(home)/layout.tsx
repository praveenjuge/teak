import type { ReactNode } from "react";
import { CTASection } from "@/components/CTASection";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <div className="pt-20">
        {children}
        <CTASection
          description="Start bookmarking, organizing, and managing your most important design inspiration with Teak."
          emoji={{
            src: "/emojis/cta-bookmark.webp",
            alt: "Bookmark emoji",
            size: 72,
          }}
          primaryCTA={{
            text: "Get Started",
            href: "https://app.teakvault.com",
          }}
          title="Ready to start visual bookmarking?"
        />
        <Footer />
      </div>
    </>
  );
}
