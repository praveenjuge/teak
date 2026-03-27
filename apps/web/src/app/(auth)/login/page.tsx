import { SignIn } from "@clerk/nextjs";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const resolveNextPath = (value: string | string[] | undefined): string => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!(rawValue?.startsWith("/") && !rawValue.startsWith("//"))) {
    return "/";
  }
  return rawValue;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = resolveNextPath(params?.next);

  return (
    <SignIn
      appearance={{
        elements: {
          card: "shadow-none border-0 p-0 bg-transparent",
          footer: "hidden",
          headerTitle: "text-center text-lg",
          headerSubtitle: "hidden",
          socialButtonsBlockButton: "h-10",
        },
      }}
      forceRedirectUrl={nextPath}
      path="/login"
      routing="path"
      signUpUrl={
        nextPath === "/"
          ? "/register"
          : `/register?next=${encodeURIComponent(nextPath)}`
      }
    />
  );
}
