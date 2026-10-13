import { TagsPageClient } from "./TagsPageClient";

// Like the home page, this waits on the session check in the app layout.
export const instant = false;

export default function TagsPage() {
  return <TagsPageClient />;
}
