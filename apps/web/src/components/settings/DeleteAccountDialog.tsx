import { useTranslations } from "@teak/i18n/react";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Trash } from "vadivam-react";
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
  const t = useTranslations("settings.deleteAccount");
  const tc = useTranslations("common");
  const confirmPhrase = t("confirmPhrase");
  const [confirmation, setConfirmation] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  // Every open starts empty, however the last one closed (Cancel, Escape,
  // the close button or a click outside).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setConfirmation("");
    }
  }

  const confirmationMatches =
    confirmation.trim().toLowerCase() === confirmPhrase.toLowerCase();

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
      description={t("description")}
      footer={
        <>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {tc("cancel")}
          </Button>
          <Button
            disabled={!confirmationMatches || loading}
            form={FORM_ID}
            type="submit"
            variant="destructive"
          >
            {loading ? <Spinner /> : t("submit")}
          </Button>
        </>
      }
      icon={Trash}
      onOpenChange={onOpenChange}
      open={open}
      title={t("title")}
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
              {t.rich("confirmPrompt", {
                phrase: confirmPhrase,
                strong: (chunks) => (
                  <span className="font-medium text-foreground">{chunks}</span>
                ),
              })}
            </span>
          </Label>
          <Input
            autoComplete="off"
            id="deleteConfirm"
            onChange={handleConfirmationChange}
            value={confirmation}
          />
        </form>
      </SettingsDialogBody>
    </SettingsDialog>
  );
}
