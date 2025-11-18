"use client";

import { useEffect, useMemo, useState } from "react";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import { authClient } from "@/lib/auth-client";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ProfileSettingsPage() {
  // @ts-ignore
  const user = useQuery(api.auth.getCurrentUser);
  // @ts-ignore
  const deleteAccount = useMutation(api.users.deleteAccount);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();

  const userInitials = useMemo(() => {
    if (!user?.email) return "U";
    const [local] = user.email.split("@");
    const parts = local.split(".").filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }, [user?.email]);

  useEffect(() => {
    if (!isEditingName) {
      setNameInput(user?.name ?? "");
    }
  }, [isEditingName, user?.name]);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();

    setIsSaving(true);
    try {
      await authClient.updateUser(
        { name: trimmed },
        {
          onSuccess: () => {
            setIsEditingName(false);
          },
          onError: (ctx) => {
            toast.error(ctx.error?.message ?? "Failed to update name");
          },
        }
      );
    } catch (error) {
      toast.error("Something went wrong while updating your name.");
    } finally {
      setIsSaving(false);
    }
  };

  const nameMissing = (user?.name ?? "").trim() === "";
  const displayName = nameMissing ? "" : (user?.name ?? nameInput);
  const isLoading = user === undefined;

  const handleResetPassword = async () => {
    setResetError(null);

    if (newPassword !== confirmPassword) {
      setResetError("New password and confirmation do not match.");
      return;
    }

    setIsResetting(true);
    try {
      await authClient.changePassword(
        {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        {
          onSuccess: () => {
            toast.success("Password updated");
            setResetOpen(false);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setResetError(null);
          },
          onError: (ctx) => {
            setResetError(ctx.error?.message ?? "Failed to update password");
          },
        }
      );
    } catch (error) {
      setResetError("Something went wrong while updating your password.");
    } finally {
      setIsResetting(false);
    }
  };

  const confirmationMatches =
    deleteConfirmation.trim().toLowerCase() === "delete account";

  const handleDeleteAccount = async () => {
    if (!confirmationMatches) {
      toast.error('Type "delete account" to confirm.');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteAccount({});

      let deleteUserFailed = false;
      await authClient.deleteUser(undefined, {
        onSuccess: async () => {
          //@ts-ignore
          router.push("/login");
        },
        onError: (ctx) => {
          setDeleteError(ctx.error?.message ?? "Failed to delete account.");
          deleteUserFailed = true;
        },
      });

      if (deleteUserFailed) {
        return;
      }

      setDeleteOpen(false);
      setDeleteConfirmation("");
    } catch (error) {
      setDeleteError("Something went wrong while deleting your account.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-7">
      <h1 className="text-xl font-semibold tracking-tight">Profile Settings</h1>

      <div className="flex justify-between items-center">
        <CardTitle>Profile Picture</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Avatar className="size-7 text-xs font-semibold">
            <AvatarImage alt="Profile preview" src={user?.image ?? undefined} />
            <AvatarFallback>{userInitials}</AvatarFallback>
          </Avatar>
          <div className="flex items-center">
            <Button size="sm" variant="link">
              Upload
            </Button>
            <span className="text-border">|</span>
            <Button size="sm" variant="link">
              Remove
            </Button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Name</CardTitle>
        <div className="flex items-center gap-2">
          {isEditingName ? (
            <>
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Add your name"
                className="w-48"
              />
              <Button size="sm" onClick={handleSaveName} disabled={isSaving}>
                {isSaving ? <Spinner /> : "Save"}
              </Button>
            </>
          ) : isLoading ? (
            <Button disabled size="sm" variant="ghost">
              <Spinner />
            </Button>
          ) : displayName ? (
            <>
              <span className="font-medium">{displayName}</span>
              <Button
                size="sm"
                variant="link"
                onClick={() => setIsEditingName(true)}
              >
                Edit
              </Button>
            </>
          ) : (
            <>
              <Button disabled size="sm" variant="ghost" className="-mr-3">
                You haven't added a name yet
              </Button>
              <Button
                size="sm"
                variant="link"
                onClick={() => setIsEditingName(true)}
              >
                Add
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Email</CardTitle>
        <Button disabled size="sm" variant="ghost">
          {isLoading ? <Spinner /> : (user?.email ?? "Not available")}
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Password</CardTitle>
        <Button size="sm" variant="link" onClick={() => setResetOpen(true)}>
          Reset password
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Delete Account</CardTitle>
        <Button size="sm" variant="link" onClick={() => setDeleteOpen(true)}>
          Delete
        </Button>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {resetError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{resetError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleResetPassword} disabled={isResetting}>
              {isResetting ? <Spinner /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This action permanently removes your account, cards, and uploaded
              files.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Permanent and irreversible</AlertTitle>
              <AlertDescription>
                All of your cards, tags, and stored files will be deleted. This
                cannot be undone.
              </AlertDescription>
            </Alert>

            {deleteError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="deleteConfirm">
                Type "delete account" to proceed
              </Label>
              <Input
                id="deleteConfirm"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="delete account"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={!confirmationMatches || isDeleting}
            >
              {isDeleting ? <Spinner /> : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
