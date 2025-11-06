export default function ChangelogLoading() {
  return (
    <div className="container mx-auto max-w-xl py-12 px-4">
      {[...Array(3)].map((_, monthIndex) => (
        <div key={monthIndex} className="mb-12">
          <div className="space-y-4">
            {[...Array(5)].map((_, entryIndex) => (
              <div
                key={entryIndex}
                className="border rounded-lg p-6 bg-background"
              >
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-muted rounded-full animate-pulse flex-shrink-0"></div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="h-6 bg-muted rounded-md animate-pulse w-20"></div>
                      <div className="h-4 bg-muted rounded animate-pulse w-24"></div>
                      <div className="h-4 bg-muted rounded animate-pulse w-20"></div>
                    </div>

                    <div className="h-5 bg-muted rounded animate-pulse mb-2 w-full"></div>

                    <div className="flex items-center gap-4">
                      <div className="h-4 bg-muted rounded animate-pulse w-24"></div>
                      <div className="h-4 bg-muted rounded animate-pulse w-16"></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
