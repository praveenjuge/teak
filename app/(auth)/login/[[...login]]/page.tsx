import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <SignIn
      appearance={{
        elements: {
          cardBox: "!w-full !shadow-none !border",
        },
      }}
    />
  );
}
