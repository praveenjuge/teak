import { AlertTriangle } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { ErrorAlert } from "./ErrorAlert";

interface DeleteAccountDialogProps {
  error: string | null;
  loading: boolean;
  onDelete: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function DeleteAccountDialog({
  open,
  onOpenChange,
  onDelete,
  error,
  loading,
}: DeleteAccountDialogProps) {
  const [confirmation, setConfirmation] = useState("");

  const confirmationMatches =
    confirmation.trim().toLowerCase() === "delete account";

  const handleDelete = async () => {
    if (!confirmationMatches) {
      return;
    }
    await onDelete();
  };

  const handleConfirmationChange = (event: ChangeEvent<HTMLInputElement>) =>
    setConfirmation(event.target.value);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
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

          <ErrorAlert message={error} />

          <div className="space-y-2">
            <Label htmlFor="deleteConfirm">
              Type &quot;delete account&quot; to proceed
            </Label>
            <Input
              id="deleteConfirm"
              onChange={handleConfirmationChange}
              placeholder="delete account"
              value={confirmation}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!confirmationMatches || loading}
            onClick={handleDelete}
            variant="destructive"
          >
            {loading ? <Spinner /> : "Delete account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
