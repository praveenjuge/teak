"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
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
} from "@teak/ui/components/ui/dropdown-menu";
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
} from "@teak/ui/components/ui/sidebar";
import { useMutation } from "convex/react";
import {
  Folder,
  FolderSearch,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFolders } from "../../hooks/useFolders";
import {
  FOLDER_COLOR_LABELS,
  FOLDER_COLORS,
  FOLDER_ICON_CLASSES,
  type FolderColor,
  type FolderSummary,
  folderErrorMessage,
  folderPath,
} from "../../lib/folders";
import { FolderDot } from "../folders/FolderDot";
import { FolderNameDialog } from "../folders/FolderNameDialog";
import type { SidebarLinkComponent } from "./AppSidebar";

const SKELETON_WIDTHS = ["62%", "48%", "70%"];

interface SidebarFoldersProps {
  /** The folder being viewed, highlighted in the list. */
  activeFolderId: string | null;
  LinkComponent: SidebarLinkComponent;
  /** Called when the open folder is deleted, to leave its page. */
  onActiveFolderDeleted?: () => void;
  /** Called before a folder link navigates (e.g. to remember scroll). */
  onNavigate?: () => void;
}

/**
 * The Folders group in the sidebar: every folder with its card count, a
 * New folder button, and a menu (or right-click) to rename, recolor or
 * delete. Smart folders show a search icon, no count (their cards are
 * found when opened) and Edit search. Deleting offers Undo for a few
 * seconds.
 */
export function SidebarFolders({
  activeFolderId,
  LinkComponent,
  onActiveFolderDeleted,
  onNavigate,
}: SidebarFoldersProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const folders = useFolders();
  const [dialog, setDialog] = useState<{
    focusQuery?: boolean;
    folder: FolderSummary | null;
  } | null>(null);
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);

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

  const navigate = () => {
    onNavigate?.();
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const setColor = (folder: FolderSummary, color: FolderColor | null) => {
    updateFolder({ folderId: folder._id, color }).catch((error) =>
      toast.error(folderErrorMessage(error, "Couldn't change the color"))
    );
  };

  const restore = (folder: FolderSummary) => {
    restoreFolder({ folderId: folder._id as Id<"folders"> }).catch((error) =>
      toast.error(folderErrorMessage(error, "Couldn't restore the folder"))
    );
  };

  const remove = async (folder: FolderSummary) => {
    const wasActive = folder._id === activeFolderId;
    try {
      await deleteFolder({ folderId: folder._id });
    } catch (error) {
      toast.error(folderErrorMessage(error, "Couldn't delete the folder"));
      return;
    }
    if (wasActive) {
      onActiveFolderDeleted?.();
    }
    toast.success(`Deleted “${folder.name}”`, {
      description: "Its cards are still in your library.",
      id: `folder-delete-${folder._id}`,
      action: { label: "Undo", onClick: () => restore(folder) },
    });
  };

  const openCreate = () => setDialog({ folder: null });

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Folders</SidebarGroupLabel>
      <SidebarGroupAction onClick={openCreate} title="New folder">
        <Plus />
        <span className="sr-only">New folder</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {folders === undefined &&
          SKELETON_WIDTHS.map((width) => (
            <SidebarMenuItem key={width}>
              <SidebarMenuSkeleton showIcon width={width} />
            </SidebarMenuItem>
          ))}
        {folders?.length === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton
              className="text-sidebar-foreground/70"
              onClick={openCreate}
              tooltip="New folder"
            >
              <Plus />
              <span>New folder</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {folders?.map((folder) => {
          const isActive = folder._id === activeFolderId;
          const isSmart = folder.kind === "smart";
          const Icon = isSmart ? FolderSearch : Folder;
          return (
            <SidebarMenuItem
              key={folder._id}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuFolderId(folder._id);
              }}
            >
              <SidebarMenuButton
                asChild
                isActive={isActive}
                tooltip={folder.name}
              >
                <LinkComponent
                  aria-current={isActive ? "page" : undefined}
                  href={folderPath(folder._id)}
                  onClick={navigate}
                >
                  <Icon
                    className={
                      folder.color
                        ? FOLDER_ICON_CLASSES[folder.color]
                        : "text-sidebar-foreground/60"
                    }
                  />
                  <span dir="auto" title={folder.name}>
                    {folder.name}
                  </span>
                </LinkComponent>
              </SidebarMenuButton>
              {!isSmart && folder.activeCardCount > 0 && (
                <SidebarMenuBadge className="text-sidebar-foreground/55 transition-opacity group-has-data-[state=open]/menu-item:opacity-0 max-md:right-8 md:group-hover/menu-item:opacity-0 md:group-focus-within/menu-item:opacity-0">
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
                    aria-label={`More for ${folder.name}`}
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
                    Rename…
                  </DropdownMenuItem>
                  {isSmart && (
                    <DropdownMenuItem
                      onSelect={() => setDialog({ folder, focusQuery: true })}
                    >
                      <FolderSearch />
                      Edit search…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette />
                      Color
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
                          No color
                        </DropdownMenuRadioItem>
                        {FOLDER_COLORS.map((color) => (
                          <DropdownMenuRadioItem key={color} value={color}>
                            <FolderDot color={color} />
                            {FOLDER_COLOR_LABELS[color]}
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
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          );
        })}
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
