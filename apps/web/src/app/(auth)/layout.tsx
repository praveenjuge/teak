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
    <section className="mx-auto max-w-xs flex flex-col items-center gap-6 py-14 md:py-26 md:h-lh w-full">
      <Link href="/login">
        <Logo variant="primary" />
      </Link>
      <Card className="w-full">{children}</Card>
      {/* Background patterns */}
      <TopPattern />
      <BottomPattern />
    </section>
  );
}
