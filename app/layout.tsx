import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Teak",
  description: "Teak",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="text-sm antialiased caret-primary accent-primary selection:bg-primary selection:text-primary-foreground [font-feature-settings:&quot;ss02&quot;,_&quot;ss03&quot;,_&quot;ss04&quot;,_&quot;ss07&quot;,_&quot;ss08&quot;,_&quot;ss09&quot;] [text-rendering:optimizeLegibility] [touch-action:manipulation]">
        <ClerkProvider
          dynamic
          signInUrl="/login"
          signUpUrl="/register"
          appearance={{
            theme: "simple",
          }}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
