import { Button } from "@teak/ui/components/ui/button";
import { Trash2, X } from "lucide-react";

interface BulkActionBarProps {
  onCancel: () => void;
  onDelete: () => void;
  selectedCount: number;
}

export function BulkActionBar({
  selectedCount,
  onDelete,
  onCancel,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 transform">
      <div className="flex items-center gap-4 rounded-lg border bg-background px-4 py-3 shadow-lg">
        <span className="font-medium text-sm">
          {selectedCount} card{selectedCount !== 1 ? "s" : ""} selected
        </span>
        <div className="flex gap-2">
          <Button
            disabled={selectedCount === 0}
            onClick={onDelete}
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
    </div>
  );
}
