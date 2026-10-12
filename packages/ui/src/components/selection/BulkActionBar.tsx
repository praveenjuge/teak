import { Button } from "@teak/ui/components/ui/button";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { registerBulkActionBar } from "../../lib/bulkActionBarPresence";
import { ConfirmDialog } from "../ui/confirm-dialog";

interface BulkActionBarProps {
  onCancel: () => void;
  onDelete: () => void;
  selectedCount: number;
}

const cardCountLabel = (count: number) =>
  `${count} card${count === 1 ? "" : "s"}`;

export function BulkActionBar({
  selectedCount,
  onDelete,
  onCancel,
}: BulkActionBarProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // Lets the toaster move above the bar while it is on screen.
  useEffect(() => registerBulkActionBar(), []);

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 transform">
      <div className="flex items-center gap-4 rounded-2xl border bg-background px-4 py-3 shadow-lg">
        <span aria-live="polite" className="font-medium text-sm">
          {cardCountLabel(selectedCount)} selected
        </span>
        <div className="flex gap-2">
          <Button
            disabled={selectedCount === 0}
            onClick={() => setIsConfirmOpen(true)}
            size="sm"
            variant="destructive"
          >
            <Trash2 />
            Delete
          </Button>
          <Button onClick={onCancel} size="sm" variant="outline">
            <X />
            Cancel
          </Button>
        </div>
      </div>
      <ConfirmDialog
        confirmLabel={`Delete ${cardCountLabel(selectedCount)}`}
        description="They move to Trash, where you can restore them."
        onConfirm={onDelete}
        onOpenChange={setIsConfirmOpen}
        open={isConfirmOpen}
        title={`Delete ${cardCountLabel(selectedCount)}?`}
      />
    </div>
  );
}
