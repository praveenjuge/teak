import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { FolderSearch, Pencil } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { FOLDER_ICON_CLASSES, type FolderSummary } from "../../lib/folders";
import { PageTitle } from "../app-shell/PageHeader";
import { FolderDot } from "./FolderDot";

/**
 * A folder page's title: a smart folder's name with a button to edit its
 * search, a folder's name with its card count and a button to edit it (its
 * name, color and rules), plain "Folder" while it loads, or "Folder not
 * found" when it's gone, matching the tab title.
 */
export function FolderPageTitle({
  folder,
  onEditFolder,
  onEditSearch,
}: {
  folder: FolderSummary | null | undefined;
  onEditFolder: () => void;
  onEditSearch: () => void;
}) {
  const t = useTranslations("screens.cards");
  const intlLocale = useIntlLocale();
  if (folder?.kind === "smart") {
    return (
      <PageTitle
        icon={
          <FolderSearch
            aria-hidden="true"
            className={
              folder.color
                ? `size-4 shrink-0 ${FOLDER_ICON_CLASSES[folder.color]}`
                : "size-4 shrink-0 text-muted-foreground"
            }
          />
        }
        trailing={
          <Button
            aria-label={t("editSearch")}
            className="size-7 shrink-0 text-muted-foreground"
            onClick={onEditSearch}
            size="icon"
            title={t("editSearch")}
            variant="ghost"
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      >
        <span title={folder.name}>{folder.name}</span>
        <span className="sr-only">{t("smartFolderSuffix")}</span>
      </PageTitle>
    );
  }
  if (folder) {
    return (
      <PageTitle
        count={
          <>
            {folder.activeCardCount.toLocaleString(intlLocale)}
            <span className="sr-only">
              {t("folderCardCountSuffix", {
                count: folder.activeCardCount,
              })}
            </span>
          </>
        }
        icon={<FolderDot className="size-2" color={folder.color} />}
        trailing={
          <Button
            aria-label={t("editFolder")}
            className="size-7 shrink-0 text-muted-foreground"
            onClick={onEditFolder}
            size="icon"
            title={t("editFolder")}
            variant="ghost"
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      >
        <span title={folder.name}>{folder.name}</span>
      </PageTitle>
    );
  }
  if (folder === null) {
    return <PageTitle>{t("folderNotFound")}</PageTitle>;
  }
  return <PageTitle>{t("folderTitle")}</PageTitle>;
}
