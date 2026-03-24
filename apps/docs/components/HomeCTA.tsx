"use client";

import { Button } from "@teak/ui/components/ui/button";
import posthog from "posthog-js";

export function HomeCTA() {
  return (
    <Button asChild size="lg">
      <a
        href="https://app.teakvault.com/register"
        onClick={() =>
          posthog.capture("cta_clicked", {
            location: "hero",
            cta_text: "Start Free",
          })
        }
        rel="noopener noreferrer"
        target="_blank"
      >
        Start Free
      </a>
    </Button>
  );
}
