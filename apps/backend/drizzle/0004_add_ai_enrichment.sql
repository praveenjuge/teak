-- Add AI enrichment fields to cards table
ALTER TABLE "cards" ADD COLUMN "aiSummary" text;
ALTER TABLE "cards" ADD COLUMN "aiTags" jsonb;
ALTER TABLE "cards" ADD COLUMN "aiTranscript" text;
ALTER TABLE "cards" ADD COLUMN "aiProcessedAt" timestamp;

-- Create AI Settings table
CREATE TABLE IF NOT EXISTS "aiSettings" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"openaiBaseUrl" text,
	"openaiApiKey" text,
	"aiTextModelName" text,
	"aiImageTextModelName" text,
	"embeddingModelName" text,
	"audioTranscriptModelName" text,
	"fileTranscriptModelName" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraint
ALTER TABLE "aiSettings" ADD CONSTRAINT "aiSettings_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade;

-- Add AI enrichment job types to jobType enum
ALTER TYPE "jobType" ADD VALUE 'ai-enrich-text';
ALTER TYPE "jobType" ADD VALUE 'ai-enrich-image';
ALTER TYPE "jobType" ADD VALUE 'ai-enrich-pdf';
ALTER TYPE "jobType" ADD VALUE 'ai-enrich-audio';
ALTER TYPE "jobType" ADD VALUE 'ai-enrich-url';