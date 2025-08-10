import { useState } from "react";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { CardData } from "./Card";

interface EditCardFormProps {
  card: CardData;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function EditCardForm({ card, onSuccess, onCancel }: EditCardFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form data initialized with card data
  const [title, setTitle] = useState(card.title || "");
  const [content, setContent] = useState(card.content);
  const [url, setUrl] = useState(card.url || "");
  const [tags, setTags] = useState<string[]>(card.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [description, setDescription] = useState(card.description || "");
  
  const updateCard = useMutation(api.cards.updateCard);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      await updateCard({
        id: card._id as any, // TODO: Fix Convex types
        title: title.trim() || undefined,
        content: content.trim(),
        url: url.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        description: description.trim() || undefined,
      });

      onSuccess?.();
    } catch (error) {
      console.error("Failed to update card:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      addTag();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Edit {card.type.charAt(0).toUpperCase() + card.type.slice(1)} Card
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="h-8 w-8"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Title */}
          <div className="mb-4">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a title for your content"
              className="mt-1"
            />
          </div>

          {/* Content */}
          <div className="mb-4">
            <Label htmlFor="edit-content">Content</Label>
            <Textarea
              id="edit-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Content..."
              className="mt-1 min-h-[120px]"
              required
            />
          </div>

          {/* URL (for links or any card with URL) */}
          {(card.type === "link" || card.url) && (
            <div className="mb-4">
              <Label htmlFor="edit-url">URL</Label>
              <Input
                id="edit-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="mt-1"
              />
            </div>
          )}

          {/* Description */}
          <div className="mb-4">
            <Label htmlFor="edit-description">Description</Label>
            <Input
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description or additional notes..."
              className="mt-1"
            />
          </div>

          {/* Tags */}
          <div className="mb-6">
            <Label htmlFor="edit-tags">Tags</Label>
            <div className="flex flex-wrap gap-2 mt-1 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              id="edit-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add tags (press Enter)"
              className="mt-1"
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}