import type { Card } from './api';

// Component prop interfaces
export interface CardItemProps {
  card: Card;
  onDelete?: () => void;
}

export interface CardsGridProps {
  searchQuery?: string;
  selectedType?: Card['type'];
}

// Common UI state types
export interface AsyncState {
  isLoading: boolean;
  error: string;
  success: boolean;
}

// Generic API response type
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

// Auth form types
export interface AuthFormData {
  email: string;
  password: string;
  confirmPassword?: string;
  name?: string;
}

// Search context type
export interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedType: Card['type'] | undefined;
  setSelectedType: (type: Card['type'] | undefined) => void;
}
