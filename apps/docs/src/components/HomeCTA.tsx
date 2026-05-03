import { Button } from "@teak/ui/components/ui/button";

export function HomeCTA() {
  return (
    <Button asChild size="lg">
      <a
        href="https://app.teakvault.com/register"
        rel="noopener noreferrer"
        target="_blank"
      >
        Start Free
      </a>
    </Button>
  );
}
