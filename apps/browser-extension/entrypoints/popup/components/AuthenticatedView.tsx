import { useState } from 'react';
import { authClient } from '../lib/auth-client';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthenticatedViewProps {
  user: User;
  onLogout: () => void;
}

export function AuthenticatedView({ user, onLogout }: AuthenticatedViewProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await authClient.signOut();
      onLogout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="authenticated-view">
      <div className="user-info">
        <h2>Welcome back!</h2>
        <div className="user-details">
          <p><strong>Name:</strong> {user.name}</p>
          <p><strong>Email:</strong> {user.email}</p>
        </div>
      </div>
      
      <div className="actions">
        <button 
          className="logout-button" 
          disabled={isLoading}
          onClick={handleLogout}
        >
          {isLoading ? 'Signing out...' : 'Sign Out'}
        </button>
      </div>
    </div>
  );
}