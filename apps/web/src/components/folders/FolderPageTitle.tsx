import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { useState } from "react";
import { FolderSearch, Pencil, Zap } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { useFolderRuleRunToast } from "@/hooks/useFolderRuleRunToast";
import { cn } from "@/lib/utils";
import {
  FOLDER_ICON_CLASSES,
  type FolderSummary,
  hasFolderRules,
} from "../../lib/folders";
import { PageTitle } from "../../screens/PageHeader";
import { FolderRulesDialog } from "../lazyDialogs";
import { FolderDot } from "./FolderDot";

/**
 * A folder page's title: a smart folder's name with a button to edit its
 * search, a folder's name with its card count, plain "Folder" while it
 * loads, or "Folder not found" when it's gone, matching the tab title.
 */
export function FolderPageTitle({
  folder,
  onEditSearch,
}: {
  folder: FolderSummary | null | undefined;
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
        trailing={<FolderRulesButton folder={folder} />}
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

/** Opens a manual folder's rules; lit when it has some. */
function FolderRulesButton({ folder }: { folder: FolderSummary }) {
  const t = useTranslations("screens.cards");
  const [open, setOpen] = useState(false);
  const followRuleRun = useFolderRuleRunToast();
  const active = hasFolderRules(folder);
  return (
    <>
      <Button
        aria-label={t("folderRules")}
        aria-pressed={active}
        className={cn(
          "size-7 shrink-0",
          active ? "text-foreground" : "text-muted-foreground"
        )}
        onClick={() => setOpen(true)}
        size="icon"
        title={t("folderRules")}
        variant="ghost"
      >
        <Zap className={cn("size-3.5", active && "fill-current")} />
      </Button>
      <FolderRulesDialog
        folder={folder}
        onOpenChange={setOpen}
        onRunStarted={followRuleRun}
        open={open}
      />
    </>
  );
}
