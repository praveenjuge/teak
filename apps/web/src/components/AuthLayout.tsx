import { memo, Suspense, lazy } from "react";
import Logo from "./Logo";

// Lazy load patterns for better performance
const TopPattern = lazy(() =>
  import("@/components/patterns/TopPattern").then((m) => ({
    default: m.TopPattern,
  }))
);
const BottomPattern = lazy(() =>
  import("@/components/patterns/BottomPattern").then((m) => ({
    default: m.BottomPattern,
  }))
);

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout = memo(({ children }: AuthLayoutProps) => {
  return (
    <>
      <main className="mx-auto flex max-w-xs flex-col items-center justify-center space-y-8 py-14 md:h-screen">
        <Logo />
        <section className="w-full space-y-5">{children}</section>
      </main>

      {/* Lazy load patterns for better performance */}
      <Suspense fallback={null}>
        <TopPattern />
        <BottomPattern />
      </Suspense>
    </>
  );
});

AuthLayout.displayName = "AuthLayout";
