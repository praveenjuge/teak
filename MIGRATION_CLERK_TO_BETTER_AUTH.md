# Clerk to Better Auth Migration Guide

This guide covers migrating from Clerk to Better Auth for the Teak project, which uses a monorepo architecture with Next.js web app, Expo mobile app, Chrome extension, and Convex backend.

#### Web App (Next.js)

- **Package**: `@clerk/nextjs`
- **Features**:
  - Route protection via `clerkMiddleware`
  - Authentication UI with `SignIn` and `SignUp` components
  - User profile management with `UserButton`
  - Convex integration through `ConvexProviderWithClerk`
  - shadcn theme integration

#### Mobile App (Expo)

- **Package**: `@clerk/clerk-expo`
- **Features**:
  - Authentication hooks: `useSignIn`, `useSignUp`, `useAuth`
  - Token persistence with `tokenCache`
  - Sign-out functionality via `useClerk`
  - Convex integration for authenticated API calls

#### Browser Extension (Chrome)

- **Package**: `@clerk/chrome-extension`
- **Features**:
  - Popup authentication
  - Sign-in modal integration
  - User session management

#### Backend (Convex)

- **Configuration**: `backend/convex/auth.config.ts`
- **Integration**: JWT-based authentication with `CLERK_JWT_ISSUER_DOMAIN`

## Migration Plan

### Phase 1: Backend Setup (Convex Integration)

#### 1.1 Install Dependencies

```bash
# In backend directory
bun add better-auth@1.3.27 --save-exact
bun add @convex-dev/better-auth
```

#### 1.2 Update Convex Configuration

- Replace `backend/convex/auth.config.ts` with Better Auth configuration
- Register Better Auth component in `convex/convex.config.ts`
- Set up Better Auth instance in `convex/auth.ts`

#### 1.3 Environment Variables

**Remove:**

- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER_DOMAIN`

**Add:**

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- Social provider credentials (if needed)

#### 1.4 Database Migration

- Export user data from Clerk
- Create migration scripts for Convex database
- Import existing users into Better Auth schema

### Phase 2: Web App Migration

#### 2.1 Dependencies

```bash
# In apps/web
bun remove @clerk/nextjs @clerk/clerk-react @clerk/themes @clerk/testing
bun add better-auth
```

#### 2.2 Provider Updates

- Replace `ClerkProvider` with Better Auth client provider
- Update `ConvexClientProvider` to use `ConvexBetterAuthProvider`
- Remove shadcn theme imports

#### 2.3 Middleware Changes

- Replace `clerkMiddleware` with Better Auth protection
- Update route matching logic

#### 2.4 Component Replacements

- Replace `SignIn` and `SignUp` with custom auth forms
- Replace `UserButton` with custom user profile component
- Update authentication hooks (`useUser`, `useAuth`)

#### 2.5 Testing Updates

- Update Playwright tests from `@clerk/testing` to Better Auth patterns
- Modify authentication test helpers

### Phase 3: Mobile App Migration

#### 3.1 Dependencies

```bash
# In apps/mobile
bun remove @clerk/clerk-expo
bun add better-auth @better-auth/expo expo-secure-store
```

#### 3.2 Configuration Updates

- Add Expo plugin to Better Auth server config
- Update Metro bundler configuration
- Configure deep linking schemes

#### 3.3 Client Setup

- Replace `ClerkProvider` with Better Auth Expo client
- Update authentication flows to use Better Auth methods
- Migrate from `tokenCache` to `expo-secure-store`

#### 3.4 Component Updates

- Replace sign-in/sign-up screens with custom implementations
- Update user profile and settings screens
- Modify authentication hooks

### Phase 4: Browser Extension Migration

#### 4.1 Dependencies

```bash
# In apps/extension
bun remove @clerk/chrome-extension
bun add better-auth
```

#### 4.2 Authentication Flow

- Replace Chrome extension-specific auth with standard web client
- Update popup authentication implementation
- Ensure proper cookie/storage handling for extension context

#### 4.3 UI Updates

- Replace Clerk components with custom auth UI
- Update user session management

## Implementation Details

### Better Auth Configuration Examples

#### Convex Integration

```typescript
// convex/auth.ts
import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: process.env.SITE_URL!,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [convex()],
  });
};
```

#### Web Client Setup

```typescript
// lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [convexClient()],
});
```

#### Expo Client Setup

```typescript
// lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  plugins: [
    expoClient({
      scheme: "teak",
      storagePrefix: "teak",
      storage: SecureStore,
    }),
  ],
});
```

### Documentation

- [Better Auth Documentation](https://better-auth.com/docs)
- [Convex + Better Auth Integration](https://convex-better-auth.netlify.app/)
- [Expo Integration Guide](https://better-auth.com/docs/integrations/expo)
