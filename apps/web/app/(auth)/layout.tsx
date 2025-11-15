import { TopPattern } from "@/components/patterns/TopPattern";
import { BottomPattern } from "@/components/patterns/BottomPattern";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <main className="mx-auto grid max-w-xs place-items-center py-14 md:h-screen w-full">
        {children}
      </main>

      {/* Background patterns */}
      <TopPattern />
      <BottomPattern />
    </>
  );
}
