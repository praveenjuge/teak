'use client';

export default function ChangelogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container mx-auto max-w-4xl py-12 px-4">
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4">Changelog</h1>
        <p className="text-xl text-muted-foreground">
          Stay updated with the latest changes and improvements to Teak.
        </p>
      </div>

      <div className="text-center py-12">
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto mb-4 text-destructive">
            <svg
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-full h-full"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold mb-2">Failed to Load Changelog</h2>
          <p className="text-muted-foreground mb-6">
            We encountered an error while fetching the latest updates. This might be due to GitHub API rate limits or network issues.
          </p>
        </div>

        <div className="space-x-4">
          <button
            onClick={reset}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
          <a
            href="https://github.com/praveenjuge/teak/commits/main"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 border border-border rounded-md hover:bg-accent transition-colors inline-block"
          >
            View on GitHub
          </a>
        </div>

        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-left max-w-2xl mx-auto">
            <h3 className="font-semibold text-destructive mb-2">Development Error Details:</h3>
            <p className="text-destructive/80 text-sm font-mono">
              {error.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}