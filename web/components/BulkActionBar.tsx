import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BulkActionBarProps {
  selectedCount: number;
  onDelete: () => void;
  onCancel: () => void;
}

export function BulkActionBar({
  selectedCount,
  onDelete,
  onCancel,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50">
      <div className="bg-background border rounded-lg shadow-lg px-4 py-3 flex items-center gap-4">
        <span className="text-sm font-medium">
          {selectedCount} card{selectedCount !== 1 ? "s" : ""} selected
        </span>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={selectedCount === 0}
          >
            <Trash2 />
            Delete
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
