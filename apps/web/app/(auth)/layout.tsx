import { ClerkLoaded, ClerkLoading } from "@clerk/nextjs";
import { Loading } from "@/components/Loading";
import { TopPattern } from "@/components/patterns/TopPattern";
import { BottomPattern } from "@/components/patterns/BottomPattern";

export const experimental_ppr = true;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <main className="mx-auto grid max-w-xs place-items-center py-14 md:h-screen w-full">
        <ClerkLoading>
          <Loading />
        </ClerkLoading>
        <ClerkLoaded>{children}</ClerkLoaded>
      </main>

      {/* Background patterns */}
      <TopPattern />
      <BottomPattern />
    </>
  );
}
