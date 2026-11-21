import { createFileRoute } from "@tanstack/react-router";
import { decodeFolderSegment } from "@/lib/folders";
import { titleHead } from "@/lib/pageTitle";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const Route = createFileRoute("/_app/f/$folderId")({
  head: titleHead("Folder"),
  component: FolderPage,
});

function FolderPage() {
  const folderId = decodeFolderSegment(Route.useParams().folderId);
  return <LibraryScreen folderId={folderId} key={folderId} />;
}
