"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import {
  FolderPlus,
  FolderSearch,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import { UNDO_TOAST_DURATION_MS } from "@/constants/toast";
import { useServerErrors } from "@/hooks/useServerErrors";
import { clipFolderName } from "@/lib/clipFolderName";
import { useFolders } from "../../hooks/useFolders";
import {
  CARD_DRAG_TYPE,
  FOLDER_COLORS,
  FOLDER_ICON_CLASSES,
  type FolderColor,
  type FolderSummary,
  folderPath,
  isCardDrag,
} from "../../lib/folders";
import { cn } from "../../lib/utils";
import { FolderDot } from "../folders/FolderDot";
import { FolderNameDialog } from "../lazyDialogs";
import type { SidebarLinkComponent } from "./AppSidebar";
import { SidebarNewFolder } from "./SidebarNewFolder";

const SKELETON_WIDTHS = ["62%", "48%", "70%"];

const folderSkeletonRows = SKELETON_WIDTHS.map((width) => (
  <SidebarMenuItem key={width}>
    <SidebarMenuSkeleton showIcon width={width} />
  </SidebarMenuItem>
));

export function SidebarFoldersSkeleton() {
  const t = useTranslations("sidebar.folders");
  return (
    <SidebarGroup className="pt-3">
      <SidebarGroupLabel>{t("title")}</SidebarGroupLabel>
      <SidebarMenu>{folderSkeletonRows}</SidebarMenu>
    </SidebarGroup>
  );
}

interface SidebarFoldersProps {
  activeFolderId: string | null;
  LinkComponent: SidebarLinkComponent;
  onActiveFolderDeleted?: () => void;
  onNavigate?: () => void;
}

export function SidebarFolders({
  activeFolderId,
  LinkComponent,
  onActiveFolderDeleted,
  onNavigate,
}: SidebarFoldersProps) {
  const t = useTranslations("sidebar.folders");
  const tColors = useTranslations("folders.colors");
  const tc = useTranslations("common");
  const errors = useServerErrors();
  const { isMobile, setOpenMobile } = useSidebar();
  const folders = useFolders();
  const [dialog, setDialog] = useState<{
    focusQuery?: boolean;
    folder: FolderSummary | null;
  } | null>(null);
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);

  const updateFolder = useMutation(
    api.folders.updateFolder
  ).withOptimisticUpdate((localStore, { folderId, color }) => {
    const current = localStore.getQuery(api.folders.listFolders, {});
    if (current && color !== undefined) {
      localStore.setQuery(
        api.folders.listFolders,
        {},
        current.map((folder: FolderSummary) =>
          folder._id === folderId
            ? { ...folder, color: color ?? undefined }
            : folder
        )
      );
    }
  });
  const deleteFolder = useMutation(
    api.folders.deleteFolder
  ).withOptimisticUpdate((localStore, { folderId }) => {
    const current = localStore.getQuery(api.folders.listFolders, {});
    if (current) {
      localStore.setQuery(
        api.folders.listFolders,
        {},
        current.filter((folder: FolderSummary) => folder._id !== folderId)
      );
    }
  });
  const restoreFolder = useMutation(api.folders.restoreFolder);
  const addCardsToFolder = useMutation(api.folders.addCardsToFolder);

  const dropCard = async (folder: FolderSummary, cardId: string) => {
    try {
      const result = await addCardsToFolder({
        folderId: folder._id as Id<"folders">,
        cardIds: [cardId as Id<"cards">],
      });
      if (result.folderLimitIds.length > 0) {
        toast.error(errors.byKey("folders.TOO_MANY_FOLDERS_ON_CARD"));
      } else if (result.failedIds.length > 0) {
        toast.error(t("addFailed"));
      } else {
        toast.success(t("addedCard", { folder: clipFolderName(folder.name) }));
      }
    } catch (error) {
      toast.error(errors.message(error, t("addFailed")));
    }
  };

  const navigate = () => {
    onNavigate?.();
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const setColor = (folder: FolderSummary, color: FolderColor | null) => {
    updateFolder({ folderId: folder._id, color }).catch((error) =>
      toast.error(errors.message(error, t("colorFailed")))
    );
  };

  const restore = (folder: FolderSummary) => {
    restoreFolder({ folderId: folder._id as Id<"folders"> }).catch((error) =>
      toast.error(errors.message(error, t("restoreFailed")))
    );
  };

  const deleteNow = async (folder: FolderSummary) => {
    try {
      await deleteFolder({ folderId: folder._id });
    } catch (error) {
      toast.error(errors.message(error, t("deleteFailed")));
      return;
    }
    toast.success(t("deleted", { name: clipFolderName(folder.name) }), {
      description: t("deletedDescription"),
      duration: UNDO_TOAST_DURATION_MS,
      id: `folder-delete-${folder._id}`,
      action: { label: tc("undo"), onClick: () => restore(folder) },
    });
  };

  // The folder open on screen is deleted only once the page has left it, so
  // it never shows "Folder not found" on the way out.
  const leftFolderRef = useRef<FolderSummary | null>(null);
  useEffect(() => {
    const leftFolder = leftFolderRef.current;
    if (leftFolder && leftFolder._id !== activeFolderId) {
      leftFolderRef.current = null;
      deleteNow(leftFolder).catch(() => undefined);
    }
  });

  const remove = async (folder: FolderSummary) => {
    if (folder._id === activeFolderId && onActiveFolderDeleted) {
      leftFolderRef.current = folder;
      onActiveFolderDeleted();
      return;
    }
    await deleteNow(folder);
  };

  const openCreate = () => setIsCreating(true);

  return (
    <SidebarGroup className="pt-3">
      <SidebarGroupLabel>{t("title")}</SidebarGroupLabel>
      {folders?.length !== 0 && (
        <SidebarGroupAction
          className="top-3.5"
          onClick={openCreate}
          title={t("newFolder")}
        >
          <Plus />
          <span className="sr-only">{t("newFolder")}</span>
        </SidebarGroupAction>
      )}
      <SidebarMenu>
        {folders === undefined && folderSkeletonRows}
        {folders?.length === 0 && !isCreating && (
          <SidebarMenuItem>
            <div className="mt-0.5 rounded-lg border border-sidebar-border border-dashed px-3 pt-2.5 pb-3 group-data-[collapsible=icon]:hidden">
              <p className="text-balance text-[12px] text-sidebar-foreground/55 leading-snug">
                {t("emptyHint")}
              </p>
              <button
                className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-md bg-sidebar-accent px-2.5 font-medium text-[12px] text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-border focus-visible:ring-2 [&>svg]:size-3.5"
                onClick={openCreate}
                type="button"
              >
                <FolderPlus aria-hidden="true" />
                {t("newFolder")}
              </button>
            </div>
            <SidebarMenuButton
              aria-label={t("newFolder")}
              className="hidden group-data-[collapsible=icon]:flex"
              onClick={openCreate}
              tooltip={t("newFolder")}
            >
              <FolderPlus />
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {folders?.map((folder) => {
          const isActive = folder._id === activeFolderId;
          const isSmart = folder.kind === "smart";
          const isDropTarget = dropFolderId === folder._id;
          return (
            <SidebarMenuItem
              key={folder._id}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuFolderId(folder._id);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  setDropFolderId(null);
                }
              }}
              onDragOver={(event) => {
                if (isSmart || !isCardDrag(event.dataTransfer)) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDropFolderId(folder._id);
              }}
              onDrop={(event) => {
                setDropFolderId(null);
                const cardId = event.dataTransfer.getData(CARD_DRAG_TYPE);
                if (isSmart || !cardId) {
                  return;
                }
                event.preventDefault();
                dropCard(folder, cardId).catch(() => undefined);
              }}
            >
              <SidebarMenuButton
                asChild
                className={cn(
                  isDropTarget &&
                    "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-ring"
                )}
                isActive={isActive}
                tooltip={folder.name}
              >
                <LinkComponent
                  aria-current={isActive ? "page" : undefined}
                  href={folderPath(folder._id)}
                  onClick={navigate}
                >
                  {isSmart ? (
                    <FolderSearch
                      className={
                        folder.color
                          ? FOLDER_ICON_CLASSES[folder.color]
                          : undefined
                      }
                    />
                  ) : (
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      <FolderDot className="size-[7px]" color={folder.color} />
                    </span>
                  )}
                  <span dir="auto" title={folder.name}>
                    {folder.name}
                  </span>
                </LinkComponent>
              </SidebarMenuButton>
              {!isSmart && folder.activeCardCount > 0 && (
                <SidebarMenuBadge className="transition-opacity group-has-data-[state=open]/menu-item:opacity-0 max-md:right-8 md:group-hover/menu-item:opacity-0 md:group-focus-within/menu-item:opacity-0">
                  {folder.activeCardCount}
                </SidebarMenuBadge>
              )}
              <DropdownMenu
                onOpenChange={(open) =>
                  setMenuFolderId(open ? folder._id : null)
                }
                open={menuFolderId === folder._id}
              >
                <DropdownMenuTrigger asChild>
                  <SidebarMenuAction
                    aria-label={t("moreFor", { name: folder.name })}
                    showOnHover
                  >
                    <MoreHorizontal />
                  </SidebarMenuAction>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align={isMobile ? "end" : "start"}
                  className="w-48"
                  side={isMobile ? "bottom" : "right"}
                >
                  <DropdownMenuItem onSelect={() => setDialog({ folder })}>
                    <Pencil />
                    {t("renameItem")}
                  </DropdownMenuItem>
                  {isSmart && (
                    <DropdownMenuItem
                      onSelect={() => setDialog({ folder, focusQuery: true })}
                    >
                      <FolderSearch />
                      {t("editSearch")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette />
                      {t("color")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40">
                      <DropdownMenuRadioGroup
                        onValueChange={(value) =>
                          setColor(
                            folder,
                            value === "none" ? null : (value as FolderColor)
                          )
                        }
                        value={folder.color ?? "none"}
                      >
                        <DropdownMenuRadioItem value="none">
                          <FolderDot />
                          {tColors("none")}
                        </DropdownMenuRadioItem>
                        {FOLDER_COLORS.map((color) => (
                          <DropdownMenuRadioItem key={color} value={color}>
                            <FolderDot color={color} />
                            {tColors(color)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      remove(folder).catch(() => undefined);
                    }}
                    variant="destructive"
                  >
                    <Trash2 />
                    {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          );
        })}
        {isCreating ? (
          <SidebarNewFolder
            folders={folders}
            onDone={() => setIsCreating(false)}
          />
        ) : null}
      </SidebarMenu>
      <FolderNameDialog
        focusQuery={dialog?.focusQuery}
        folder={dialog?.folder}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        open={dialog !== null}
      />
    </SidebarGroup>
  );
}
