import { SignUp } from "@clerk/nextjs";

type RegisterPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const resolveNextPath = (value: string | string[] | undefined): string => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!(rawValue?.startsWith("/") && !rawValue.startsWith("//"))) {
    return "/";
  }
  return rawValue;
};

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const params = await searchParams;
  const nextPath = resolveNextPath(params?.next);

  return (
    <SignUp
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
      path="/register"
      routing="path"
      signInUrl={
        nextPath === "/"
          ? "/login"
          : `/login?next=${encodeURIComponent(nextPath)}`
      }
    />
  );
}
