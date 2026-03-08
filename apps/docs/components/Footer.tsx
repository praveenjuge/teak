import { Button } from "@teak/ui/components/ui/button";
import { BottomPattern } from "@teak/ui/patterns";
import Image from "next/image";
import Logo from "@/components/Logo";

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-background px-4 pt-20 pb-8">
      <BottomPattern className="absolute right-0 bottom-0 z-0" />
      <div className="relative z-10 mx-auto max-w-lg">
        <div className="pb-12 text-center">
          {/* Thiings source: https://lftz25oez4aqbxpq.public.blob.vercel-storage.com/image-WTzQemgI0sKVWwbmuJiv5AppLYBsEA.png */}
          <Image
            alt="Bookmark emoji"
            className="mx-auto mb-4 object-contain"
            height={72}
            src="/emojis/cta-bookmark.webp"
            unoptimized
            width={72}
          />
          <h2 className="mx-auto mb-4 max-w-sm text-balance font-bold text-4xl tracking-tight">
            Ready to start visual bookmarking?
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-balance text-lg text-muted-foreground">
            Start bookmarking, organizing, and managing your most important
            design inspiration with Teak.
          </p>
          <Button asChild size="lg">
            <a
              href="https://app.teakvault.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              Get Started
            </a>
          </Button>
        </div>

        <div className="mt-16 flex flex-row items-center justify-between gap-4">
          <Logo />
          <div className="flex gap-6 text-muted-foreground">
            <a
              aria-label="GitHub"
              className="transition-colors hover:text-foreground"
              href="https://github.com/praveenjuge/teak"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg
                height="24"
                viewBox="0 0 24 24"
                width="24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>GitHub</title>
                <g
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                >
                  <path d="M10 20.568c-3.429 1.157-6.286 0-8-3.568" />
                  <path d="M10 22v-3.242c0-.598.184-1.118.48-1.588c.204-.322.064-.78-.303-.88C7.134 15.452 5 14.107 5 9.645c0-1.16.38-2.25 1.048-3.2c.166-.236.25-.354.27-.46c.02-.108-.015-.247-.085-.527c-.283-1.136-.264-2.343.16-3.43c0 0 .877-.287 2.874.96c.456.285.684.428.885.46s.469-.035 1.005-.169A9.5 9.5 0 0 1 13.5 3a9.6 9.6 0 0 1 2.343.28c.536.134.805.2 1.006.169c.2-.032.428-.175.884-.46c1.997-1.247 2.874-.96 2.874-.96c.424 1.087.443 2.294.16 3.43c-.07.28-.104.42-.084.526s.103.225.269.461c.668.95 1.048 2.04 1.048 3.2c0 4.462-2.134 5.807-5.177 6.643c-.367.101-.507.559-.303.88c.296.47.48.99.48 1.589V22" />
                </g>
              </svg>
            </a>
            <a
              aria-label="X"
              className="transition-colors hover:text-foreground"
              href="https://x.com/praveenjuge"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg
                height="24"
                viewBox="0 0 24 24"
                width="24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>X</title>
                <path
                  d="m3 21l7.548-7.548M21 3l-7.548 7.548m0 0L8 3H3l7.548 10.452m2.904-2.904L21 21h-5l-5.452-7.548"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
