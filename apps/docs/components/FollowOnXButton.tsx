"use client";

import { Button } from "@teak/ui/components/ui/button";
import posthog from "posthog-js";

export function FollowOnXButton() {
  return (
    <Button asChild variant="outline">
      <a
        href="https://x.com/praveenjuge"
        onClick={() => posthog.capture("changelog_follow_x_clicked")}
        rel="noopener noreferrer"
        target="_blank"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <title>X Logo</title>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Follow on X
      </a>
    </Button>
  );
}
