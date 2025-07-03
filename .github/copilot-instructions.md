## Rules

- Prefer bun instead of node
- Use shadcn components without any changes to default styling
- Use rm -rf instead of just rm
- Use Drizzle ORM for database operations
- Run `bun run dev` for full-stack development
- Use `bun run db:studio` for database management
- Follow the Docker development setup when needed
- Don't implement any toast ui notifications

## Architecture

- Backend: Hono.js with Bun runtime
- Frontend: React, TanStack Router, TanStack Query, Vite
- Database: PostgreSQL with Drizzle ORM
- Mobile: React Native with Expo
- Auth: Better Auth
- Styling: Tailwind CSS with shadcn/ui components
- Deployment: Docker with Docker Compose

## File Structure

- `apps/web/` - React frontend application
- `apps/mobile/` - React Native mobile application
- `backend/` - Hono.js backend API
- `docker/` - Docker configuration files
- `scripts/` - Build and development scripts

### Database (Drizzle + PostgreSQL)

- Define schemas in `backend/src/db/schema.ts`
- Use Drizzle's table definitions with proper relationships
- Use TypeScript types generated from Drizzle schemas
- Prefer `timestamp` over `date` for date fields
- Always include `createdAt` and `updatedAt` fields
- Use strict TypeScript configuration
- Follow RESTful conventions for route naming
- Use proper HTTP status codes
- Implement consistent error response format
- Use middleware for cross-cutting concerns (auth, logging, CORS)
- Return proper JSON responses with appropriate headers
- Use Better Auth for all authentication flows
- Implement proper session management
- Use the auth client hooks for frontend state
- Protect routes with authentication middleware
- Handle authentication errors gracefully

## Security Best Practices

- Validate all inputs using Zod schemas
- Use CSRF protection for state-changing operations
- Implement proper CORS configuration
- Use environment variables for sensitive configuration
- Follow secure session management practices
- Sanitize user inputs to prevent XSS
