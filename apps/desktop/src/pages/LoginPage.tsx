import { LoginForm } from "@/components/LoginForm";
import { TeakLogo } from "@/components/TeakLogo";
import { Card } from "@/components/ui/card";

interface LoginPageProps {
  isOnline: boolean;
}

export function LoginPage({ isOnline }: LoginPageProps) {
  return (
    <section className="mx-auto flex min-h-screen w-full max-w-xs flex-col items-center justify-center gap-6 px-4 py-14">
      <TeakLogo />
      <Card className="w-full">
        <LoginForm isOnline={isOnline} />
      </Card>
    </section>
  );
}
