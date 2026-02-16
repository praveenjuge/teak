import Logo from "@teak/ui/logo";
import Link from "next/link";
import { BottomPattern } from "@/components/patterns/BottomPattern";
import { TopPattern } from "@/components/patterns/TopPattern";
import { Card } from "@/components/ui/card";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <section className="mx-auto flex w-full max-w-xs flex-col items-center gap-6 py-14 md:h-lh md:py-26">
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
