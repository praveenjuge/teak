import { useEffect, useRef } from "react";
import { RESERVED_KEYWORDS, type TypeaheadOption } from "@/lib/types";

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
      className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto"
    >
      {filteredOptions.map((option, index) => (
        <button
          key={option.value}
          className={`w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center gap-2 ${
            index === selectedIndex ? "bg-gray-100" : ""
          }`}
          onClick={() => onSelect(option)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="text-sm font-medium text-purple-600">
            {option.value === "favorites" ? "Show:" : "Filter:"}
          </span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
