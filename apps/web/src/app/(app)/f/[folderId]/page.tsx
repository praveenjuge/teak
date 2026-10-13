import { FolderPageClient } from "./FolderPageClient";

// Like the home page, this waits on the session check in the app layout.
export const instant = false;

export default function FolderPage() {
  return <FolderPageClient />;
}
