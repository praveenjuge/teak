// Authentication and database entity types

// Core database entities
export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string;
  userAgent?: string;
  userId: string;
}

export interface Account {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
  password?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Verification {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbCard {
  id: number;
  type: 'audio' | 'text' | 'url' | 'image' | 'video';
  data: Record<string, any>;
  metaInfo: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  userId: string;
}

// Authentication request/response types
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  user?: User;
  session?: Session;
  error?: string;
}

export interface SessionResponse {
  data?: {
    user: User;
    session: Session;
  };
  error?: {
    message: string;
  };
}

// Type aliases for backward compatibility
export type AuthUser = User;
export type AuthSession = Session;
