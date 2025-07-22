import { useTags } from '@teak/shared-queries';
import { Check, Loader2, Plus, X } from 'lucide-react';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { apiClient } from '@/lib/api';

interface TagAutocompleteProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  className?: string;
}

export function TagAutocomplete({
  selectedTags,
  onTagsChange,
  className,
}: TagAutocompleteProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');

  // Fetch available tags
  const { data: tagsData, isLoading, error } = useTags(apiClient);
  const availableTags = tagsData?.tags || [];

  // Filter suggestions based on input and exclude already selected tags
  const filteredTags = availableTags
    .filter(
      (tag) =>
        !selectedTags.includes(tag.name) &&
        tag.name.toLowerCase().includes(inputValue.toLowerCase())
    )
    .slice(0, 10); // Limit to 10 suggestions for performance

  const handleSelectTag = (tagName: string) => {
    if (!selectedTags.includes(tagName)) {
      onTagsChange([...selectedTags, tagName]);
    }
    setInputValue('');
    setOpen(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onTagsChange(selectedTags.filter((tag) => tag !== tagToRemove));
  };

  const handleCreateNewTag = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !selectedTags.includes(trimmedValue)) {
      onTagsChange([...selectedTags, trimmedValue]);
      setInputValue('');
      setOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      // If there's an exact match in suggestions, use it, otherwise create new
      const exactMatch = filteredTags.find(
        (tag) => tag.name.toLowerCase() === inputValue.toLowerCase()
      );
      if (exactMatch) {
        handleSelectTag(exactMatch.name);
      } else {
        handleCreateNewTag();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={className}>
      {/* Display selected tags */}
      {selectedTags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selectedTags.map((tag, index) => (
            <Badge key={index} variant="outline">
              {tag}
              <button onClick={() => handleRemoveTag(tag)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Tag input with autocomplete */}
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button disabled={isLoading} size="sm" variant="outline">
            {isLoading ? <Loader2 className="animate-spin" /> : <Plus />}
            Add
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput
              className="h-9"
              onKeyDown={handleKeyDown}
              onValueChange={setInputValue}
              placeholder="Search tags or create new..."
              value={inputValue}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    <span className="text-muted-foreground text-sm">
                      Loading tags...
                    </span>
                  </div>
                ) : error ? (
                  <div className="py-4 text-center">
                    <span className="text-muted-foreground text-sm">
                      Failed to load tags
                    </span>
                    {inputValue.trim() && (
                      <div className="mt-2">
                        <Button
                          className="text-xs"
                          onClick={handleCreateNewTag}
                          size="sm"
                          variant="ghost"
                        >
                          <Plus className="mr-2 h-3 w-3" />
                          Create "{inputValue.trim()}"
                        </Button>
                      </div>
                    )}
                  </div>
                ) : inputValue.trim() ? (
                  <div className="py-2">
                    <Button
                      className="w-full justify-start text-xs"
                      onClick={handleCreateNewTag}
                      size="sm"
                      variant="ghost"
                    >
                      <Plus className="mr-2 h-3 w-3" />
                      Create "{inputValue.trim()}"
                    </Button>
                  </div>
                ) : (
                  <div className="py-4 text-center text-muted-foreground text-sm">
                    Start typing to search tags...
                  </div>
                )}
              </CommandEmpty>

              {filteredTags.length > 0 && (
                <CommandGroup heading="Existing tags">
                  {filteredTags.map((tag) => (
                    <CommandItem
                      className="flex items-center justify-between"
                      key={tag.name}
                      onSelect={() => handleSelectTag(tag.name)}
                    >
                      <div className="flex items-center">
                        <Check
                          className={`mr-2 h-4 w-4 ${
                            selectedTags.includes(tag.name)
                              ? 'opacity-100'
                              : 'opacity-0'
                          }`}
                        />
                        {tag.name}
                      </div>
                      <Badge className="text-xs" variant="secondary">
                        {tag.count}
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Show create option when there's input and no exact match */}
              {inputValue.trim() &&
                !filteredTags.some(
                  (tag) => tag.name.toLowerCase() === inputValue.toLowerCase()
                ) && (
                  <CommandGroup heading="Create new tag">
                    <CommandItem onSelect={handleCreateNewTag}>
                      <Plus />
                      Create "{inputValue.trim()}"
                    </CommandItem>
                  </CommandGroup>
                )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
