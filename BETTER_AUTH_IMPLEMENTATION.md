# Better Auth Implementation Guide

## Quick Start

This guide provides step-by-step instructions for implementing Better Auth in the Teak project after migrating from Clerk.

## Backend Implementation

### 1. Install Dependencies

```bash
# In backend directory
bun add better-auth@1.3.27 --save-exact
bun add @convex-dev/better-auth
```

### 2. Configure Convex Integration

#### Update `convex/convex.config.ts`

```typescript
import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp();
app.use(betterAuth);

export default app;
```

#### Create `convex/auth.config.ts`

```typescript
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
```

#### Create `convex/auth.ts`

```typescript
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  return betterAuth({
    logger: {
      disabled: optionsOnly,
    },
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    plugins: [convex()],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
```

#### Create `convex/http.ts`

```typescript
import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

export default http;
```

### 3. Set Environment Variables

```bash
# Generate secret
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# Set site URL
npx convex env set SITE_URL http://localhost:3000

# Add social providers (optional)
npx convex env set GITHUB_CLIENT_ID=your_github_client_id
npx convex env set GITHUB_CLIENT_SECRET=your_github_client_secret
npx convex env set GOOGLE_CLIENT_ID=your_google_client_id
npx convex env set GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 4. Generate Database Schema

```bash
npx @better-auth/cli generate
```

## Web App Implementation (Next.js)

### 1. Install Dependencies

```bash
# In apps/web
bun remove @clerk/nextjs @clerk/clerk-react @clerk/themes @clerk/testing
bun add better-auth @convex-dev/better-auth
```

### 2. Create Auth Client

#### Create `apps/web/lib/auth-client.ts`

```typescript
import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [convexClient()],
});
```

### 3. Update Route Handler

#### Create `apps/web/app/api/auth/[...all]/route.ts`

```typescript
import { nextJsHandler } from "@convex-dev/better-auth/nextjs";

export const { GET, POST } = nextJsHandler();
```

### 4. Update Providers

#### Update `apps/web/components/ConvexClientProvider.tsx`

```typescript
"use client";

import React from "react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
  expectAuth: true,
});

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
```

#### Update `apps/web/app/layout.tsx`

```typescript
import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Teak",
  description:
    "Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className='font-sans text-sm antialiased caret-primary accent-primary selection:bg-primary selection:text-primary-foreground [font-feature-settings:"ss01"] [text-rendering:optimizeLegibility] touch-manipulation'>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          disableTransitionOnChange
          enableSystem={false}
        >
          <ConvexClientProvider>
            <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
          </ConvexClientProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### 5. Create Authentication Components

#### Create `apps/web/components/auth/SignInForm.tsx`

```typescript
"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await authClient.signIn.email({
        email,
        password,
      });
    } catch (error) {
      console.error("Sign in error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
        <CardDescription>Enter your credentials to access your account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSignIn} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

#### Create `apps/web/components/auth/SignUpForm.tsx`

```typescript
"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await authClient.signUp.email({
        email,
        password,
        name,
      });
    } catch (error) {
      console.error("Sign up error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign Up</CardTitle>
        <CardDescription>Create a new account to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Creating account..." : "Sign Up"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

#### Create `apps/web/components/auth/UserButton.tsx`

```typescript
"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function UserButton() {
  const { data: session } = authClient.useSession();

  if (!session?.user) {
    return null;
  }

  const handleSignOut = async () => {
    await authClient.signOut();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage src={session.user.image} alt={session.user.name || ""} />
            <AvatarFallback>
              {session.user.name?.charAt(0).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <div className="flex items-center justify-start gap-2 p-2">
          <div className="flex flex-col space-y-1 leading-none">
            {session.user.name && <p className="font-medium">{session.user.name}</p>}
            {session.user.email && (
              <p className="w-[200px] truncate text-sm text-muted-foreground">
                {session.user.email}
              </p>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 6. Update Authentication Pages

#### Update `apps/web/app/(auth)/login/[[...login]]/page.tsx`

```typescript
import { SignInForm } from "@/components/auth/SignInForm";

export default function LoginPage() {
  return (
    <div className="container relative h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
        <div className="absolute inset-0 bg-zinc-900" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          Teak
        </div>
      </div>
      <div className="flex h-full items-center p-4 lg:p-8">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
          <div className="flex flex-col space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter your credentials to sign in to your account
            </p>
          </div>
          <SignInForm />
        </div>
      </div>
    </div>
  );
}
```

#### Update `apps/web/app/(auth)/register/[[...register]]/page.tsx`

```typescript
import { SignUpForm } from "@/components/auth/SignUpForm";

export default function RegisterPage() {
  return (
    <div className="container relative h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
        <div className="absolute inset-0 bg-zinc-900" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          Teak
        </div>
      </div>
      <div className="flex h-full items-center p-4 lg:p-8">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
          <div className="flex flex-col space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Create an account
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter your information to get started
            </p>
          </div>
          <SignUpForm />
        </div>
      </div>
    </div>
  );
}
```

### 7. Update Middleware

#### Update `apps/web/middleware.ts`

```typescript
import { authMiddleware } from "better-auth/next-js";

export default authMiddleware({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
});

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

### 8. Update Components Using Auth

#### Update `apps/web/components/SearchBar.tsx`

```typescript
// Replace UserButton import
import { UserButton } from "@/components/auth/UserButton";

// Rest of component remains the same
```

## Mobile App Implementation (Expo)

### 1. Install Dependencies

```bash
# In apps/mobile
bun remove @clerk/clerk-expo
bun add better-auth @better-auth/expo expo-secure-store
```

### 2. Update Metro Configuration

#### Update `apps/mobile/metro.config.js`

```javascript
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

module.exports = config;
```

### 3. Create Auth Client

#### Create `apps/mobile/lib/auth-client.ts`

```typescript
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

### 4. Update App Configuration

#### Update `apps/mobile/app.json`

```json
{
  "expo": {
    "scheme": "teak",
    "name": "Teak",
    "slug": "teak"
  }
}
```

### 5. Update Provider

#### Update `apps/mobile/ConvexClientProvider.tsx`

```typescript
"use client";

import React from "react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "./lib/auth-client";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  expectAuth: true,
});

export default function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
```

### 6. Update Authentication Screens

#### Update `apps/mobile/app/(auth)/sign-in.tsx`

```typescript
import { useState } from "react";
import { View, TextInput, Button, Text, StyleSheet } from "react-native";
import { authClient } from "@/lib/auth-client";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await authClient.signIn.email({
        email,
        password,
      });
    } catch (error) {
      console.error("Sign in error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign In</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Button
        title={isLoading ? "Signing in..." : "Sign In"}
        onPress={handleSignIn}
        disabled={isLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    height: 40,
    borderColor: "gray",
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 10,
  },
});
```

#### Update `apps/mobile/app/(auth)/sign-up.tsx`

```typescript
import { useState } from "react";
import { View, TextInput, Button, Text, StyleSheet } from "react-native";
import { authClient } from "@/lib/auth-client";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async () => {
    setIsLoading(true);
    try {
      await authClient.signUp.email({
        email,
        password,
        name,
      });
    } catch (error) {
      console.error("Sign up error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign Up</Text>
      <TextInput
        style={styles.input}
        placeholder="Name"
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Button
        title={isLoading ? "Creating account..." : "Sign Up"}
        onPress={handleSignUp}
        disabled={isLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    height: 40,
    borderColor: "gray",
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 10,
  },
});
```

### 7. Update Settings Screen

#### Update `apps/mobile/app/(tabs)/settings.tsx`

```typescript
import { View, Text, StyleSheet, Button } from "react-native";
import { authClient } from "@/lib/auth-client";

export default function Settings() {
  const { data: session } = authClient.useSession();

  const handleSignOut = async () => {
    await authClient.signOut();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      {session?.user && (
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{session.user.name}</Text>
          <Text style={styles.userEmail}>{session.user.email}</Text>
        </View>
      )}
      <Button title="Sign Out" onPress={handleSignOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  userInfo: {
    marginBottom: 20,
  },
  userName: {
    fontSize: 18,
    fontWeight: "600",
  },
  userEmail: {
    fontSize: 16,
    color: "#666",
  },
});
```

## Browser Extension Implementation

### 1. Install Dependencies

```bash
# In apps/extension
bun remove @clerk/chrome-extension
bun add better-auth
```

### 2. Create Auth Client

#### Create `apps/extension/lib/auth-client.ts`

```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.PLASMO_PUBLIC_API_URL || "http://localhost:3000",
});
```

### 3. Update Popup Main

#### Update `apps/extension/entrypoints/popup/main.tsx`

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "../../style.css";

import { Loader2 } from "lucide-react";
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
} from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "../../lib/auth-client";

const EXTENSION_URL = chrome.runtime.getURL(".");
const convex = new ConvexReactClient(import.meta.env.VITE_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <AuthLoading>
        <div className="size-96 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-red-600 animate-spin" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="size-96 flex items-center flex-col justify-center p-4 text-center gap-4">
          <img src="./icon.svg" alt="Teak Logo" className="h-6" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold">
              Save Anything. Anywhere.
            </h1>
            <p className="text-sm text-gray-500 text-balance">
              Your personal everything management system. Organize, save, and
              access all your text, images, and documents in one place.
            </p>
          </div>
          <button
            onClick={() => chrome.tabs.create({ url: `${EXTENSION_URL}/options.html` })}
            className="rounded px-5 py-2 text-sm font-medium bg-red-600 text-white cursor-pointer"
          >
            Sign In
          </button>
        </div>
      </Unauthenticated>
      <Authenticated>
        <App />
      </Authenticated>
    </ConvexBetterAuthProvider>
  </React.StrictMode>
);
```

### 4. Update App Component

#### Update `apps/extension/entrypoints/popup/App.tsx`

```typescript
import { useAuthActions } from "convex/react";
import { authClient } from "../../lib/auth-client";

export default function App() {
  const { signOut } = useAuthActions();

  const handleSignOut = async () => {
    await authClient.signOut();
  };

  return (
    <div className="size-96 flex items-center flex-col justify-center p-4 text-center gap-4">
      <img src="./icon.svg" alt="Teak Logo" className="h-6" />
      <div className="space-y-1">
        <h1 className="text-base font-semibold">Welcome Back!</h1>
        <p className="text-sm text-gray-500 text-balance">
          You're signed in and ready to save content.
        </p>
      </div>
      <button
        onClick={handleSignOut}
        className="rounded px-5 py-2 text-sm font-medium bg-gray-600 text-white cursor-pointer"
      >
        Sign Out
      </button>
    </div>
  );
}
```

## Testing Implementation

### 1. Update Web Tests

#### Update `apps/web/tests/authentication.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("should show sign in form", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Welcome back");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("should navigate to sign up", async ({ page }) => {
    await page.click('a[href="/register"]');
    await expect(page.locator("h1")).toContainText("Create an account");
  });

  test("should show validation errors", async ({ page }) => {
    await page.click('button[type="submit"]');
    await expect(page.locator('input[type="email"]:invalid')).toBeVisible();
  });
});
```

### 2. Update Mobile Tests

#### Create `apps/mobile/e2e/auth.e2e.js`

```javascript
const { device, element, by, expect } = require("detox");

describe("Authentication", () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it("should show sign in form", async () => {
    await expect(element(by.id("sign-in-screen"))).toBeVisible();
    await expect(element(by.id("email-input"))).toBeVisible();
    await expect(element(by.id("password-input"))).toBeVisible();
  });

  it("should navigate to sign up", async () => {
    await element(by.id("sign-up-link")).tap();
    await expect(element(by.id("sign-up-screen"))).toBeVisible();
  });
});
```

## Environment Configuration

### 1. Development Environment

#### `.env.local`

```bash
# Better Auth
BETTER_AUTH_SECRET=your_secret_here
BETTER_AUTH_URL=http://localhost:3000

# Convex
CONVEX_DEPLOYMENT=dev:your-deployment
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://your-deployment.convex.site
SITE_URL=http://localhost:3000

# Social Providers (optional)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 2. Production Environment

#### Vercel/Deployment Environment Variables

```bash
BETTER_AUTH_SECRET=your_production_secret
BETTER_AUTH_URL=https://your-domain.com
SITE_URL=https://your-domain.com
```

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure `BETTER_AUTH_URL` is correctly set
2. **Session Not Persisting**: Check storage configuration
3. **Convex Integration**: Verify `@convex-dev/better-auth` version compatibility
4. **Mobile Deep Linking**: Ensure scheme is properly configured in `app.json`

### Debug Mode

Enable Better Auth debug logging:

```typescript
// convex/auth.ts
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    // ... other config
    logger: {
      level: "debug",
    },
  });
};
```

## Next Steps

1. **Social Providers**: Configure OAuth providers
2. **Email Verification**: Set up email sending
3. **Password Reset**: Implement forgot password flow
4. **Multi-Factor Auth**: Add 2FA support
5. **Session Management**: Configure session timeouts
6. **Rate Limiting**: Implement abuse protection
