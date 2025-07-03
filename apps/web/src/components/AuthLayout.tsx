import { Suspense, lazy } from "react";
import Logo from "./Logo";

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

export const AuthLayout = ({ children }: { children: React.ReactNode }) => {
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
};
