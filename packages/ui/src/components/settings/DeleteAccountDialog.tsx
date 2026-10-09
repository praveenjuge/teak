import { Trash2 } from "lucide-react";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { ErrorAlert } from "./ErrorAlert";
import { SettingsDialog, SettingsDialogBody } from "./SettingsDialog";

interface DeleteAccountDialogProps {
  error: string | null;
  loading: boolean;
  onDelete: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const FORM_ID = "delete-account-form";

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

  const handleDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmationMatches || loading) {
      return;
    }
    await onDelete();
  };

  const handleConfirmationChange = (event: ChangeEvent<HTMLInputElement>) =>
    setConfirmation(event.target.value);

  return (
    <SettingsDialog
      description="This permanently deletes your account, cards, tags, and uploaded files. This can’t be undone."
      footer={
        <>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!confirmationMatches || loading}
            form={FORM_ID}
            type="submit"
            variant="destructive"
          >
            {loading ? <Spinner /> : "Delete account"}
          </Button>
        </>
      }
      icon={Trash2}
      onOpenChange={onOpenChange}
      open={open}
      title="Delete account"
      tone="destructive"
    >
      <SettingsDialogBody className="space-y-4 pb-5">
        <ErrorAlert message={error} />
        <form className="space-y-2" id={FORM_ID} onSubmit={handleDelete}>
          <Label
            className="font-normal text-muted-foreground"
            htmlFor="deleteConfirm"
          >
            <span>
              Type &quot;
              <span className="font-medium text-foreground">
                delete account
              </span>
              &quot; to proceed
            </span>
          </Label>
          <Input
            autoComplete="off"
            id="deleteConfirm"
            onChange={handleConfirmationChange}
            placeholder="delete account"
            value={confirmation}
          />
        </form>
      </SettingsDialogBody>
    </SettingsDialog>
  );
}
