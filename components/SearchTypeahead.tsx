import { useEffect, useRef } from "react";
import { RESERVED_KEYWORDS, type TypeaheadOption } from "@/lib/constants";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import {
  File,
  FileText,
  Heart,
  Image,
  Link,
  Trash2,
  Video,
  Volume2,
} from "lucide-react";

// Icon mapping for typeahead options
const getOptionIcon = (value: string) => {
  switch (value) {
    case "text":
      return FileText;
    case "link":
      return Link;
    case "image":
      return Image;
    case "video":
      return Video;
    case "audio":
      return Volume2;
    case "document":
      return File;
    case "favorites":
      return Heart;
    case "trash":
      return Trash2;
    default:
      return FileText;
  }
};

interface SearchTypeaheadProps {
  searchValue: string;
  isVisible: boolean;
  onSelect: (option: TypeaheadOption) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
}

export function SearchTypeahead({
  searchValue,
  isVisible,
  onSelect,
  onClose,
  inputRef,
  selectedIndex,
  setSelectedIndex,
}: SearchTypeaheadProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = RESERVED_KEYWORDS.filter((option) =>
    option.label.toLowerCase().includes(searchValue.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isVisible, onClose, inputRef]);

  if (!isVisible || filteredOptions.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 right-0 z-50"
    >
      <Command className="bg-popover border border-border rounded-md shadow-lg">
        <CommandList className="max-h-48">
          {filteredOptions.map((option, index) => {
            const IconComponent = getOptionIcon(option.value);
            return (
              <CommandItem
                key={option.value}
                data-selected={index === selectedIndex}
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => onSelect(option)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <IconComponent />
                <span className="font-medium text-primary">
                  {option.value === "favorites" ? "Show:" : "Filter:"}
                </span>
                <span>{option.label}</span>
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
    </div>
  );
}
