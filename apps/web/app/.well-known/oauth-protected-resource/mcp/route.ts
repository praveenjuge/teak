import { protectedResourceHandlerClerk } from '@clerk/mcp-tools/next';

export const GET = protectedResourceHandlerClerk({
  resource: process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'http://localhost:3000',
  scopes_supported: ['profile', 'email'],
});