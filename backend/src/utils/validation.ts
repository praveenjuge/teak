import { z } from 'zod';
import { Context } from 'hono';

// Helper to validate request body
export async function validateBody<T>(c: Context, schema: z.ZodSchema<T>) {
  try {
    const body = await c.req.json();
    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
}

// Helper to validate query parameters
export function validateQuery<T>(c: Context, schema: z.ZodSchema<T>) {
  try {
    const query = c.req.query();
    return schema.parse(query);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Query validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
}

// Helper to validate path parameters
export function validateParams<T>(c: Context, schema: z.ZodSchema<T>) {
  try {
    const params = c.req.param();
    return schema.parse(params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Parameter validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
}

// Helper to validate card data based on type
export function validateCardData(type: string, data: any) {
  const { cardDataSchema } = require('../schemas/cards');
  
  try {
    return cardDataSchema.parse({ type, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Card data validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
}