import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { auth } from '../auth.js';
import { db } from '../db/index.js';
import { aiSettings } from '../db/schema.js';

// Inline types to avoid build issues
interface AiSettings {
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  aiTextModelName?: string;
  aiImageTextModelName?: string;
  embeddingModelName?: string;
  audioTranscriptModelName?: string;
  fileTranscriptModelName?: string;
}

interface UpdateAiSettings extends Partial<AiSettings> {}
interface CreateAiSettings extends AiSettings {
  userId: string;
}

const aiSettingsRoutes = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Get user AI settings
aiSettingsRoutes.get('/', async (c) => {
  const userId = c.get('user')?.id;

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const [userAiSettings] = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);

    if (!userAiSettings) {
      // Return empty settings if none exist
      return c.json({
        openaiBaseUrl: null,
        openaiApiKey: null,
        aiTextModelName: null,
        aiImageTextModelName: null,
        embeddingModelName: null,
        audioTranscriptModelName: null,
        fileTranscriptModelName: null,
      } satisfies Partial<AiSettings>);
    }

    // Don't return the actual API key for security
    const safeSettings: Partial<AiSettings> = {
      openaiBaseUrl: userAiSettings.openaiBaseUrl,
      openaiApiKey: userAiSettings.openaiApiKey ? '••••••••' : null,
      aiTextModelName: userAiSettings.aiTextModelName,
      aiImageTextModelName: userAiSettings.aiImageTextModelName,
      embeddingModelName: userAiSettings.embeddingModelName,
      audioTranscriptModelName: userAiSettings.audioTranscriptModelName,
      fileTranscriptModelName: userAiSettings.fileTranscriptModelName,
    };

    return c.json(safeSettings);
  } catch (error) {
    console.error('Failed to get AI settings:', error);
    return c.json({ error: 'Failed to get AI settings' }, 500);
  }
});

// Create or update user AI settings
aiSettingsRoutes.put('/', async (c) => {
  const userId = c.get('user')?.id;

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const validatedData = body as UpdateAiSettings;

    // Check if settings already exist
    const [existingSettings] = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);

    if (existingSettings) {
      // Update existing settings
      const updateData: Partial<AiSettings> = {};

      // Only update fields that are provided and not the masked API key
      if (validatedData.openaiBaseUrl !== undefined) {
        updateData.openaiBaseUrl = validatedData.openaiBaseUrl;
      }
      if (
        validatedData.openaiApiKey !== undefined &&
        validatedData.openaiApiKey !== '••••••••'
      ) {
        updateData.openaiApiKey = validatedData.openaiApiKey;
      }
      if (validatedData.aiTextModelName !== undefined) {
        updateData.aiTextModelName = validatedData.aiTextModelName;
      }
      if (validatedData.aiImageTextModelName !== undefined) {
        updateData.aiImageTextModelName = validatedData.aiImageTextModelName;
      }
      if (validatedData.embeddingModelName !== undefined) {
        updateData.embeddingModelName = validatedData.embeddingModelName;
      }
      if (validatedData.audioTranscriptModelName !== undefined) {
        updateData.audioTranscriptModelName =
          validatedData.audioTranscriptModelName;
      }
      if (validatedData.fileTranscriptModelName !== undefined) {
        updateData.fileTranscriptModelName =
          validatedData.fileTranscriptModelName;
      }

      const [updatedSettings] = await db
        .update(aiSettings)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(aiSettings.userId, userId))
        .returning();

      return c.json({ success: true, updated: true });
    }
    // Create new settings
    const newSettings = {
      ...validatedData,
      userId,
    };

    await db.insert(aiSettings).values(newSettings);

    return c.json({ success: true, created: true });
  } catch (error) {
    console.error('Failed to update AI settings:', error);
    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: 'Failed to update AI settings' }, 500);
  }
});

// Delete user AI settings
aiSettingsRoutes.delete('/', async (c) => {
  const userId = c.get('user')?.id;

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    await db.delete(aiSettings).where(eq(aiSettings.userId, userId));

    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to delete AI settings:', error);
    return c.json({ error: 'Failed to delete AI settings' }, 500);
  }
});

export default aiSettingsRoutes;
