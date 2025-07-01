import type { User } from '../db/types';

// Custom hook to fetch users using Drizzle types
export const useUsers = () => {
  const fetchUsers = async (): Promise<User[]> => {
    try {
      const response = await fetch('/api/users');
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      return data.users;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  };

  const fetchUser = async (id: string): Promise<User> => {
    try {
      const response = await fetch(`/api/users/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch user');
      }
      const data = await response.json();
      return data.user;
    } catch (error) {
      console.error('Error fetching user:', error);
      throw error;
    }
  };

  return {
    fetchUsers,
    fetchUser,
  };
};

// Type-safe user data interface
export interface UserResponse {
  users: User[];
}

export interface SingleUserResponse {
  user: User;
}
