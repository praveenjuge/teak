# Better Auth Migration Checklist

## Pre-Migration Checklist

### ✅ Planning & Preparation

- [ ] Review current Clerk implementation and features
- [ ] Identify all authentication touchpoints across platforms
- [ ] Plan user data migration strategy
- [ ] Set up development environment for testing
- [ ] Create backup of current production data
- [ ] Schedule migration window with minimal user impact

### ✅ Environment Setup

- [ ] Generate `BETTER_AUTH_SECRET`
- [ ] Set up social provider credentials (if needed)
- [ ] Configure Convex environment variables
- [ ] Update local development `.env.local`
- [ ] Set up staging environment for testing

### ✅ Dependencies & Tools

- [ ] Install Better Auth CLI tools
- [ ] Set up database migration tools
- [ ] Prepare user data export scripts from Clerk
- [ ] Create rollback procedures

## Phase 1: Backend Migration

### ✅ Convex Integration

- [ ] Install `better-auth@1.3.27` and `@convex-dev/better-auth`
- [ ] Update `convex/convex.config.ts` with Better Auth component
- [ ] Create `convex/auth.config.ts`
- [ ] Create `convex/auth.ts` with Better Auth instance
- [ ] Create `convex/http.ts` for route handlers
- [ ] Generate Better Auth database schema
- [ ] Test Convex integration locally

### ✅ User Data Migration

- [ ] Export user data from Clerk dashboard
- [ ] Create migration scripts for Better Auth schema
- [ ] Test data import in development
- [ ] Verify user credentials and sessions
- [ ] Test authentication flows with migrated data

### ✅ API Endpoints

- [ ] Set up `/api/auth/[...all]/route.ts` in web app
- [ ] Test Better Auth API endpoints
- [ ] Verify CORS configuration
- [ ] Test social provider callbacks (if configured)

## Phase 2: Web App Migration

### ✅ Dependencies Removal

- [ ] Remove `@clerk/nextjs` package
- [ ] Remove `@clerk/clerk-react` package
- [ ] Remove `@clerk/themes` package
- [ ] Remove `@clerk/testing` package
- [ ] Clean up unused Clerk imports

### ✅ Better Auth Setup

- [ ] Install `better-auth` and `@convex-dev/better-auth`
- [ ] Create `lib/auth-client.ts`
- [ ] Set up `ConvexBetterAuthProvider`
- [ ] Update `ConvexClientProvider.tsx`

### ✅ Authentication Components

- [ ] Create `SignInForm` component
- [ ] Create `SignUpForm` component
- [ ] Create `UserButton` component
- [ ] Replace Clerk components in layout
- [ ] Update authentication pages (`/login`, `/register`)

### ✅ Middleware & Protection

- [ ] Replace `clerkMiddleware` with Better Auth middleware
- [ ] Update route protection logic
- [ ] Test protected routes
- [ ] Verify public routes remain accessible

### ✅ UI Updates

- [ ] Remove Clerk CSS imports (`@clerk/themes/shadcn.css`)
- [ ] Update styling for custom auth components
- [ ] Test responsive design
- [ ] Verify accessibility features

### ✅ Testing Updates

- [ ] Update Playwright configuration
- [ ] Replace `@clerk/testing` with custom test helpers
- [ ] Update authentication test scenarios
- [ ] Test sign-in/sign-up flows
- [ ] Test protected route access

## Phase 3: Mobile App Migration

### ✅ Dependencies Removal

- [ ] Remove `@clerk/clerk-expo` package
- [ ] Clean up Clerk imports and references

### ✅ Better Auth Setup

- [ ] Install `better-auth` and `@better-auth/expo`
- [ ] Install `expo-secure-store`
- [ ] Update Metro configuration
- [ ] Create `lib/auth-client.ts` with Expo plugin
- [ ] Update `app.json` with scheme configuration

### ✅ Provider Updates

- [ ] Update `ConvexClientProvider.tsx`
- [ ] Replace `ClerkProvider` with Better Auth
- [ ] Configure secure storage
- [ ] Test authentication state persistence

### ✅ Screen Updates

- [ ] Update sign-in screen with custom form
- [ ] Update sign-up screen with custom form
- [ ] Update settings screen with user profile
- [ ] Replace `SignOutButton` with custom implementation
- [ ] Test navigation flows

### ✅ Deep Linking

- [ ] Configure deep linking schemes
- [ ] Test social provider redirects (if applicable)
- [ ] Verify app opening from auth callbacks
- [ ] Test universal links

### ✅ Testing

- [ ] Update Detox tests for new auth flows
- [ ] Test authentication on iOS simulator
- [ ] Test authentication on Android emulator
- [ ] Test app backgrounding/foregrounding with auth state

## Phase 4: Browser Extension Migration

### ✅ Dependencies Removal

- [ ] Remove `@clerk/chrome-extension` package
- [ ] Clean up Chrome-specific Clerk imports

### ✅ Better Auth Setup

- [ ] Install `better-auth`
- [ ] Create `lib/auth-client.ts`
- [ ] Update popup authentication flow
- [ ] Configure extension storage

### ✅ UI Updates

- [ ] Replace Clerk components in popup
- [ ] Update sign-in flow
- [ ] Test extension popup authentication
- [ ] Verify content script authentication

### ✅ Storage & Sessions

- [ ] Configure Chrome storage for auth tokens
- [ ] Test session persistence across browser restarts
- [ ] Verify cross-tab authentication state
- [ ] Test extension updates with existing sessions

## Post-Migration Checklist

### ✅ Testing & Validation

- [ ] Test all authentication flows end-to-end
- [ ] Verify user data integrity
- [ ] Test session management across all platforms
- [ ] Verify Convex integration works correctly
- [ ] Test social providers (if configured)
- [ ] Load test authentication endpoints
- [ ] Security audit of authentication flows

### ✅ Performance & Monitoring

- [ ] Monitor authentication success/failure rates
- [ ] Track page load times with new auth system
- [ ] Set up error tracking for auth failures
- [ ] Monitor database query performance
- [ ] Set up alerts for unusual authentication patterns

### ✅ Documentation & Communication

- [ ] Update internal documentation
- [ ] Create user migration guide (if needed)
- [ ] Update API documentation
- [ ] Communicate changes to development team
- [ ] Update deployment procedures

### ✅ Cleanup

- [ ] Remove unused Clerk environment variables
- [ ] Clean up old authentication components
- [ ] Remove unused dependencies
- [ ] Archive old authentication code
- [ ] Update README files

### ✅ Rollback Plan

- [ ] Document rollback procedures
- [ ] Test rollback in staging environment
- [ ] Prepare data rollback scripts
- [ ] Set up monitoring for rollback triggers
- [ ] Communicate rollback plan to team

## Production Deployment

### ✅ Pre-Deployment

- [ ] Complete all testing phases
- [ ] Get final approval from stakeholders
- [ ] Schedule deployment window
- [ ] Prepare production environment variables
- [ ] Backup production database

### ✅ Deployment Steps

- [ ] Deploy backend changes first
- [ ] Run database migrations
- [ ] Deploy web application
- [ ] Deploy mobile app updates
- [ ] Deploy browser extension update
- [ ] Monitor deployment health

### ✅ Post-Deployment

- [ ] Monitor authentication metrics
- [ ] Check error rates and logs
- [ ] Verify user can access all features
- [ ] Test cross-platform authentication
- [ ] Monitor performance metrics
- [ ] Collect user feedback

## Success Criteria

### ✅ Functional Requirements

- [ ] All users can sign in with existing credentials
- [ ] New user registration works correctly
- [ ] Session management works across all platforms
- [ ] Protected routes are properly secured
- [ ] Social authentication works (if implemented)

### ✅ Technical Requirements

- [ ] No degradation in performance
- [ ] Authentication success rate > 99%
- [ ] All automated tests pass
- [ ] Security audit passes
- [ ] Documentation is complete and accurate

### ✅ User Experience

- [ ] Seamless transition for existing users
- [ ] No loss of user data
- [ ] Consistent experience across platforms
- [ ] Improved performance where possible
- [ ] Clear error messages and recovery paths
