"use client";

import { TopPattern } from "@/components/patterns/TopPattern";
import { BottomPattern } from "@/components/patterns/BottomPattern";
import { Card } from "@/components/ui/card";
import Logo from "@/components/Logo";
import Link from "next/link";
import { AuthLoading, Unauthenticated } from "convex/react";
import Loading from "../loading";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <AuthLoading>
        <Loading />
      </AuthLoading>
      <Unauthenticated>
        <main className="mx-auto max-w-xs flex flex-col items-center gap-6 py-14 md:py-32 md:h-screen w-full">
          <Link href="/login">
            <Logo variant="primary" />
          </Link>
          <Card className="w-full">{children}</Card>
        </main>
      </Unauthenticated>

      {/* Background patterns */}
      <TopPattern />
      <BottomPattern />
    </>
  );
}
