import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { createAuthClientWithUrl, getStoredApiUrl } from "./auth-client";

interface AuthContextType {
  authClient: any;
  isInitialized: boolean;
  updateApiUrl: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authClient, setAuthClient] = useState<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedUrl = await getStoredApiUrl();
        const client = createAuthClientWithUrl(storedUrl);
        setAuthClient(client);
      } catch (error) {
        console.error("Failed to initialize auth client:", error);
        // Fallback to default
        const defaultUrl = __DEV__ ? "http://192.168.29.57:3000" : "";
        const client = createAuthClientWithUrl(defaultUrl);
        setAuthClient(client);
      } finally {
        setIsInitialized(true);
      }
    };

    initializeAuth();
  }, []);

  const updateApiUrl = async (url: string) => {
    const client = createAuthClientWithUrl(url);
    setAuthClient(client);
  };

  const value: AuthContextType = {
    authClient,
    isInitialized,
    updateApiUrl,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
