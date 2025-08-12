import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <SignUp
      appearance={{
        elements: {
          cardBox: "!w-full !shadow-none !border",
        },
      }}
    />
  );
}
