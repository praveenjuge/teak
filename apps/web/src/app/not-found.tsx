import type { Metadata } from "next";
import { CookieLocaleProvider } from "@/components/providers/CookieLocaleProvider";
import { NotFoundContent } from "./NotFoundContent";

// The tab title stays English: the page renders before the language is known.
export const metadata: Metadata = { title: "Page not found" };

// Unmatched URLs render here inside the root layout, so the page follows the
// theme the person picked, not only the system one.
export default function NotFound() {
  return (
    <main className="fixed inset-0 grid place-items-center p-6">
      <CookieLocaleProvider>
        <NotFoundContent />
      </CookieLocaleProvider>
    </main>
  );
}
