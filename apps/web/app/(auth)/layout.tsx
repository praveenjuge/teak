import { TopPattern } from "@/components/patterns/TopPattern";
import { BottomPattern } from "@/components/patterns/BottomPattern";
import { Card } from "@/components/ui/card";
import Logo from "@/components/Logo";
import Link from "next/link";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <main className="mx-auto max-w-xs flex flex-col justify-center items-center gap-7 py-14 md:h-screen w-full">
        {/* @ts-ignore */}
        <Link href="/login">
          <Logo variant="primary" />
        </Link>
        <Card className="w-full">{children}</Card>
      </main>

      {/* Background patterns */}
      <TopPattern />
      <BottomPattern />
    </>
  );
}
