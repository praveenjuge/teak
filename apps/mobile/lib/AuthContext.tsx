import { ReactNode, createContext, useContext, useState } from "react";
import { useRouter } from "expo-router";

// ✅ Define authentication context type
interface AuthContextType {
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}
// ✅ Create authentication context
const AuthContext = createContext<AuthContextType | null>(null);
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  
  console.log('[AuthContext] Current authentication state:', isAuthenticated);
  
  // ✅ Login function (Redirect to Home)
  const login = () => {
    console.log('[AuthContext] Login called');
    setIsAuthenticated(true);
    router.replace("/(tabs)"); // ✅ Redirect to home tab
  };
  // ✅ Logout function (Redirect to Auth Screen)
  const logout = () => {
    console.log('[AuthContext] Logout called');
    setIsAuthenticated(false);
    router.replace("/(auth)/login"); // ✅ Redirect to login screen
  };
  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
// ✅ Hook to use authentication state
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  console.log('[AuthContext] useAuth called, returning:', context);
  return context;
};
