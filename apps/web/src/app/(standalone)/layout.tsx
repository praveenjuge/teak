import { type ReactNode, Suspense } from "react";
import AuthenticatedAppProvider from "@/components/providers/AuthenticatedAppProvider";

// Signed-in pages that fill the window without the sidebar, such as
// `/open/<cardId>`. While the session loads they show an empty page, not the
// app shell, so a redirect straight on to another site shows nothing.
const quietPage = <div className="min-h-dvh bg-background" />;

export default function StandaloneLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense fallback={quietPage}>
      <AuthenticatedAppProvider loading={quietPage}>
        {children}
      </AuthenticatedAppProvider>
    </Suspense>
  );
}
