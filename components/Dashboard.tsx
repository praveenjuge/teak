import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { AddCardForm } from "./AddCardForm";
import { CardModal } from "./CardModal";
import { Card, type CardData, type CardType } from "./Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Grid3X3,
  Image as ImageIcon,
  Link as LinkIcon,
  Mic,
  Search,
  Video,
} from "lucide-react";
import { api } from "../convex/_generated/api";

const CARD_TYPE_FILTERS = [
  { type: null, label: "All", icon: Grid3X3 },
  { type: "text" as CardType, label: "Text", icon: FileText },
  { type: "link" as CardType, label: "Links", icon: LinkIcon },
  { type: "image" as CardType, label: "Images", icon: ImageIcon },
  { type: "video" as CardType, label: "Videos", icon: Video },
  { type: "audio" as CardType, label: "Audio", icon: Mic },
  { type: "document" as CardType, label: "Documents", icon: FileText },
];

export function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<CardType | null>(null);
  const [editingCard, setEditingCard] = useState<CardData | null>(null);

  const cards = useQuery(api.cards.getCards, {
    type: selectedType || undefined,
  });

  const deleteCard = useMutation(api.cards.deleteCard);

  const handleDeleteCard = async (cardId: string) => {
    if (confirm("Are you sure you want to delete this card?")) {
      try {
        await deleteCard({ id: cardId as any }); // TODO: Fix Convex types
      } catch (error) {
        console.error("Failed to delete card:", error);
      }
    }
  };

  const handleCardClick = (card: CardData) => {
    setEditingCard(card);
  };


  const handleEditCancel = () => {
    setEditingCard(null);
  };

  const filteredCards =
    cards?.filter((card) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        card.title?.toLowerCase().includes(query) ||
        card.content.toLowerCase().includes(query) ||
        card.description?.toLowerCase().includes(query) ||
        card.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }) || [];

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Filters and Search */}
      <div className="mb-6 space-y-4">
        {/* Search and User */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="Search your content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <UserButton />
        </div>

        {/* Type Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {CARD_TYPE_FILTERS.map((filter) => {
            const Icon = filter.icon;
            const isActive = selectedType === filter.type;
            return (
              <Button
                key={filter.label}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedType(filter.type)}
                className="flex items-center gap-2 whitespace-nowrap"
              >
                <Icon className="w-4 h-4" />
                {filter.label}
              </Button>
            );
          })}
        </div>
      </div>

      <Separator className="my-4" />

      {/* Cards Display */}
      {filteredCards.length === 0 && !searchQuery && !selectedType ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Add Card Form as first item in grid */}
          <AddCardForm />

          <div className="text-center py-12 col-span-full">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No content yet
              </h3>
              <p className="text-gray-500 mb-4">
                Start capturing your thoughts, links, and media using the form
                above
              </p>
            </div>
          </div>
        </div>
      ) : filteredCards.length === 0 ? (
        <div className="text-center py-12">
          {cards === undefined ? (
            <p className="text-gray-500">Loading your content...</p>
          ) : (
            <div>
              <p className="text-gray-500 mb-2">
                No content found matching your filters
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedType(null);
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Add Card Form as first item in grid */}
          <AddCardForm />

          {filteredCards.map((card) => (
            <Card
              key={card._id}
              card={card}
              onClick={handleCardClick}
              onDelete={handleDeleteCard}
            />
          ))}
        </div>
      )}

      {/* Card Modal */}
      <CardModal
        card={editingCard}
        open={!!editingCard}
        onCancel={handleEditCancel}
        onDelete={handleDeleteCard}
      />
    </div>
  );
}
