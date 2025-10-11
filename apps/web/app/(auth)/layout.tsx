import { ClerkLoaded, ClerkLoading } from "@clerk/nextjs";
import { Loading } from "@/components/Loading";
import { TopPattern } from "@/components/patterns/TopPattern";
import { BottomPattern } from "@/components/patterns/BottomPattern";
import { Suspense } from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <main className="mx-auto grid max-w-xs place-items-center py-14 md:h-screen w-full">
        <Suspense fallback={<Loading />}>
          <ClerkLoading>
            <Loading />
          </ClerkLoading>
          <ClerkLoaded>
            <Suspense fallback={<Loading />}>{children}</Suspense>
          </ClerkLoaded>
        </Suspense>
      </main>

      {/* Background patterns */}
      <TopPattern />
      <BottomPattern />
    </>
  );
}
